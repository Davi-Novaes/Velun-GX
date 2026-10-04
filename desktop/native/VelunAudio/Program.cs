using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using VelunAudio;

// VelunAudio: som do PC sem um programa (padrão: Discord), em PCM 16 bits / 48 kHz / estéreo no stdout.
// Mensagens de estado em JSON (uma por linha) no stderr, para o app mostrar o que está acontecendo.
//
//   VelunAudio.exe --exclude-name Discord,DiscordPTB,DiscordCanary   (padrão)
//   VelunAudio.exe --exclude-pid 1234                               (testes)
//   VelunAudio.exe --include-hwnd 5678                              (só o som do programa dessa janela)
//   VelunAudio.exe --multi --exclude-tree-pid 4321                  (sem o Discord E sem a árvore 4321, ex.: o Velun Gx)
//   VelunAudio.exe --probe                                           (só verifica se o Windows suporta)

var excludeNames = new[] { "Discord", "DiscordPTB", "DiscordCanary" };
uint? fixedPid = null;
var mode = ProcessLoopbackMode.ExcludeTargetProcessTree;
var multi = false;
var excludedTrees = new List<uint>();
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--exclude-name": excludeNames = args[++i].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries); break;
        case "--exclude-pid": fixedPid = uint.Parse(args[++i]); break;
        case "--include-hwnd":
            Native.GetWindowThreadProcessId(new IntPtr(long.Parse(args[++i])), out var owner);
            if (owner == 0) { Status("error", ("message", "A janela escolhida não existe mais.")); return 4; }
            fixedPid = owner;
            mode = ProcessLoopbackMode.IncludeTargetProcessTree;
            break;
        case "--multi": multi = true; break;
        case "--exclude-tree-pid": excludedTrees.Add(uint.Parse(args[++i])); break;
        case "--probe": return Probe();
    }
}

var stdout = Console.OpenStandardOutput();
var stop = false;
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop = true; };
// o app fecha o stdin para pedir o encerramento
_ = Task.Run(() => { try { Console.OpenStandardInput().CopyTo(Stream.Null); } catch (IOException) { } stop = true; });

void Write(ReadOnlySpan<byte> data)
{
    stdout.Write(data);
    stdout.Flush();
}

if (multi && fixedPid is null)
{
    // Vários programas misturados: tira o Discord e também o Velun Gx (que toca o som das transmissões dos
    // outros). Se o Windows não deixar listar as sessões de áudio, cai para o modo antigo (só sem o Discord).
    try
    {
        using var capture = new MultiProcessCapture(excludeNames, excludedTrees, (evt, data) => Status(evt, data));
        capture.Run(Write, () => stop);
        Status("stopped");
        return 0;
    }
    catch (IOException)
    {
        Status("stopped");
        return 0;
    }
    catch (Exception ex) when (ex is COMException or InvalidCastException or EntryPointNotFoundException)
    {
        Status("fallback", ("message", ex.Message), ("hresult", ex.HResult));
    }
}

while (!stop)
{
    // sem Discord aberto, exclui o próprio VelunAudio (que não toca som): resultado = som do PC inteiro
    var target = fixedPid ?? ProcessTree.FindRoot(excludeNames) ?? (uint)Environment.ProcessId;
    var excluding = fixedPid is not null || target != Environment.ProcessId;
    try
    {
        using var capture = ProcessLoopbackCapture.Create(target, mode);
        if (mode == ProcessLoopbackMode.IncludeTargetProcessTree) Status("started", ("includedPid", target), ("mode", "window-app"));
        else Status("started", ("excludedPid", excluding ? target : null), ("mode", excluding ? "exclude-tree" : "everything (Discord fechado)"));
        var lastCheck = Stopwatch.StartNew();
        var restart = false;
        capture.Run(Write, () =>
        {
            if (stop) return true;
            if (fixedPid is null && lastCheck.ElapsedMilliseconds > 2000)
            {
                lastCheck.Restart();
                // Discord abriu, fechou ou reiniciou: refaz a captura excluindo a árvore nova
                var current = ProcessTree.FindRoot(excludeNames) ?? (uint)Environment.ProcessId;
                if (current != target) { restart = true; return true; }
            }
            return false;
        });
        if (restart) Status("restarting", ("reason", "programa excluído mudou"));
    }
    catch (IOException)
    {
        break; // o app fechou o stdout: encerra
    }
    catch (Exception ex) when (ex is COMException or TimeoutException or InvalidCastException)
    {
        Status("error", ("message", ex.Message), ("hresult", ex.HResult));
        Thread.Sleep(2000);
    }
}
Status("stopped");
return 0;

static int Probe()
{
    var build = Environment.OSVersion.Version.Build;
    // A documentação da Microsoft cita o build 20348 (Windows 11), mas a captura por processo funciona desde o
    // Windows 10 2004 (build 19041) — o OBS libera a partir dele. Abaixo disso nem tenta; acima, o teste real decide.
    if (build < 19041)
    {
        Status("unsupported", ("build", build), ("message", "A captura por programa exige Windows 10 versão 2004 ou mais nova."));
        return 2;
    }
    try
    {
        using var capture = ProcessLoopbackCapture.Create((uint)Environment.ProcessId, ProcessLoopbackMode.ExcludeTargetProcessTree);
        Status("supported", ("build", build));
        return 0;
    }
    catch (Exception ex) when (ex is COMException or TimeoutException or InvalidCastException)
    {
        Status("unsupported", ("build", build), ("message", ex.Message));
        return 3;
    }
}

static void Status(string evt, params (string Key, object? Value)[] data)
{
    // escrita manual: o executável é "trimmed" e não tem serialização por reflexão
    using var buffer = new MemoryStream();
    using (var json = new Utf8JsonWriter(buffer))
    {
        json.WriteStartObject();
        json.WriteString("event", evt);
        json.WriteStartObject("data");
        foreach (var (key, value) in data)
        {
            switch (value)
            {
                case null: json.WriteNull(key); break;
                case int i: json.WriteNumber(key, i); break;
                case uint u: json.WriteNumber(key, u); break;
                default: json.WriteString(key, value.ToString()); break;
            }
        }
        json.WriteEndObject();
        json.WriteEndObject();
    }
    Console.Error.WriteLine(System.Text.Encoding.UTF8.GetString(buffer.ToArray()));
    Console.Error.Flush();
}

internal static class ProcessTree
{
    /// <summary>Processo "raiz" do programa: o que tem o nome procurado e cujo pai não tem. Excluí-lo exclui a árvore toda.</summary>
    public static uint? FindRoot(string[] names)
    {
        var candidates = names.SelectMany(n => SafeGet(n)).ToList();
        if (candidates.Count == 0) return null;
        var ids = candidates.Select(p => p.Id).ToHashSet();
        foreach (var p in candidates)
        {
            var parent = ParentId(p);
            if (parent is null || !ids.Contains(parent.Value)) return (uint)p.Id;
        }
        return (uint)candidates.Min(p => p.Id);
    }

    private static Process[] SafeGet(string name)
    {
        try { return Process.GetProcessesByName(name); } catch (InvalidOperationException) { return []; }
    }

    private static int? ParentId(Process process)
    {
        try
        {
            var info = new Native.ProcessBasicInformation();
            var status = Native.NtQueryInformationProcess(process.Handle, 0, ref info, Marshal.SizeOf<Native.ProcessBasicInformation>(), out _);
            return status == 0 ? info.InheritedFromUniqueProcessId.ToInt32() : null;
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return null; // sem acesso ao processo (ex.: de outro usuário): trata como raiz
        }
    }
}
