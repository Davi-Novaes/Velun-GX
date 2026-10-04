using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VelunAudio;

/// <summary>Foto da árvore de processos (pai e nome de cada processo), tirada de uma vez via Toolhelp.</summary>
internal sealed class ProcessSnapshot
{
    private readonly Dictionary<uint, (uint Parent, string Name)> _processes = new();

    public static ProcessSnapshot Take()
    {
        var snapshot = new ProcessSnapshot();
        var handle = Native.CreateToolhelp32Snapshot(Native.Th32csSnapProcess, 0);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return snapshot;
        try
        {
            var entry = new Native.ProcessEntry32 { Size = (uint)Marshal.SizeOf<Native.ProcessEntry32>() };
            if (!Native.Process32FirstW(handle, ref entry)) return snapshot;
            do snapshot._processes[entry.ProcessId] = (entry.ParentProcessId, Path.GetFileNameWithoutExtension(entry.ExeFile));
            while (Native.Process32NextW(handle, ref entry));
        }
        finally
        {
            Native.CloseHandle(handle);
        }
        return snapshot;
    }

    public bool Exists(uint pid) => _processes.ContainsKey(pid);

    /// <summary>O próprio processo e seus ancestrais (até a raiz ou um ciclo).</summary>
    public IEnumerable<uint> SelfAndAncestors(uint pid)
    {
        var seen = new HashSet<uint>();
        for (var current = pid; current != 0 && seen.Add(current) && seen.Count <= 64; current = _processes.TryGetValue(current, out var p) ? p.Parent : 0)
        {
            yield return current;
            if (!_processes.ContainsKey(current)) yield break;
        }
    }

    public string NameOf(uint pid) => _processes.TryGetValue(pid, out var p) ? p.Name : "";
}

/// <summary>
/// Som do PC sem alguns programas. O Windows só exclui UMA árvore de processos por captura; para tirar ao mesmo
/// tempo o Discord e o próprio Velun Gx, captura cada programa que tem sessão de áudio separadamente (modo
/// "incluir") e mistura tudo. A cada segundo procura programas novos e descarta os que fecharam.
/// </summary>
internal sealed class MultiProcessCapture : IDisposable
{
    private const int FramesPer10Ms = ProcessLoopbackCapture.SampleRate / 100;
    private const int PrimeFrames = FramesPer10Ms * 3;   // 30 ms de folga por programa contra variação de entrega
    private const int MaxFrames = FramesPer10Ms * 15;    // passou de 150 ms acumulado: descarta o atraso

    private readonly string[] _excludedNames;
    private readonly HashSet<uint> _excludedTrees;
    private readonly Dictionary<uint, Source> _sources = new();
    private readonly Action<string, (string, object?)[]> _status;

    public MultiProcessCapture(string[] excludedNames, IEnumerable<uint> excludedTrees, Action<string, (string, object?)[]> status)
    {
        _excludedNames = excludedNames;
        _excludedTrees = [.. excludedTrees, (uint)Environment.ProcessId];
        _status = status;
    }

    /// <summary>Programas com sessão de áudio em qualquer saída de som ativa (alto-falante, fone, HDMI…).</summary>
    public static HashSet<uint> AudioSessionProcesses()
    {
        var result = new HashSet<uint>();
        var clsid = Native.MMDeviceEnumeratorClsid;
        var iid = Native.IMMDeviceEnumeratorIid;
        Native.CoCreateInstance(ref clsid, IntPtr.Zero, Native.ClsCtxAll, ref iid, out var enumeratorObject);
        var enumerator = (IMMDeviceEnumerator)enumeratorObject;
        try
        {
            enumerator.EnumAudioEndpoints(Native.EDataFlowRender, Native.DeviceStateActive, out var devices);
            devices.GetCount(out var deviceCount);
            for (var d = 0; d < deviceCount; d++)
            {
                devices.Item(d, out var device);
                try
                {
                    var managerIid = Native.IAudioSessionManager2Iid;
                    device.Activate(ref managerIid, Native.ClsCtxAll, IntPtr.Zero, out var managerObject);
                    var manager = (IAudioSessionManager2)managerObject;
                    manager.GetSessionEnumerator(out var sessions);
                    sessions.GetCount(out var count);
                    for (var i = 0; i < count; i++)
                    {
                        sessions.GetSession(i, out var session);
                        try
                        {
                            // som do sistema (notificações) não é de um programa: fica de fora
                            if (session.IsSystemSoundsSession() == 0) continue;
                            if (session.GetState(out var state) == 0 && state == Native.AudioSessionStateExpired) continue;
                            if (session.GetProcessId(out var pid) >= 0 && pid != 0) result.Add(pid);
                        }
                        finally { Marshal.ReleaseComObject(session); }
                    }
                    Marshal.ReleaseComObject(sessions);
                    Marshal.ReleaseComObject(manager);
                }
                catch (COMException) { /* dispositivo sumiu no meio da consulta */ }
                finally { Marshal.ReleaseComObject(device); }
            }
            Marshal.ReleaseComObject(devices);
        }
        finally
        {
            Marshal.ReleaseComObject(enumerator);
        }
        return result;
    }

    /// <summary>Quais processos capturar: sem os excluídos e sem duplicar (o modo "incluir" já pega os filhos).</summary>
    public static HashSet<uint> SelectTargets(IEnumerable<uint> sessionPids, ProcessSnapshot snapshot, string[] excludedNames, ISet<uint> excludedTrees)
    {
        bool Excluded(uint pid) => snapshot.SelfAndAncestors(pid).Any(p => excludedTrees.Contains(p) || excludedNames.Contains(snapshot.NameOf(p), StringComparer.OrdinalIgnoreCase));
        var candidates = sessionPids.Where(pid => snapshot.Exists(pid) && !Excluded(pid)).ToHashSet();
        // se o pai também tem som, capturar o pai já inclui o filho
        return candidates.Where(pid => !snapshot.SelfAndAncestors(pid).Skip(1).Any(candidates.Contains)).ToHashSet();
    }

    private void Refresh()
    {
        var snapshot = ProcessSnapshot.Take();
        var targets = SelectTargets(AudioSessionProcesses(), snapshot, _excludedNames, _excludedTrees);
        foreach (var pid in _sources.Keys.Where(pid => !targets.Contains(pid) || !snapshot.Exists(pid)).ToList())
        {
            _sources[pid].Dispose();
            _sources.Remove(pid);
        }
        foreach (var pid in targets.Where(pid => !_sources.ContainsKey(pid)))
        {
            try
            {
                _sources[pid] = new Source(pid, snapshot.NameOf(pid));
            }
            catch (Exception ex) when (ex is COMException or TimeoutException or InvalidCastException)
            {
                // processo protegido ou que fechou agora: tenta de novo no próximo ciclo
                _status("source-error", [("pid", pid), ("name", snapshot.NameOf(pid)), ("message", ex.Message)]);
            }
        }
    }

    /// <summary>Mistura os programas e entrega PCM a cada ~10 ms até <paramref name="stop"/>.</summary>
    public void Run(Action<ReadOnlySpan<byte>> onData, Func<bool> stop)
    {
        Refresh();
        _status("started", [("mode", "exclude-discord-and-app"), ("programs", _sources.Count)]);
        var clock = Stopwatch.StartNew();
        var lastRefresh = clock.ElapsedMilliseconds;
        long produced = 0;
        var mix = new int[FramesPer10Ms * 2 * 4];
        var output = new byte[FramesPer10Ms * 4 * 4];
        while (!stop())
        {
            if (clock.ElapsedMilliseconds - lastRefresh >= 1000)
            {
                lastRefresh = clock.ElapsedMilliseconds;
                var before = _sources.Count;
                Refresh();
                if (_sources.Count != before) _status("programs", [("programs", _sources.Count), ("names", string.Join(", ", _sources.Values.Select(s => s.Name)))]);
            }
            // relógio da saída: 48 000 quadros por segundo, em blocos de até 40 ms
            var due = (int)Math.Min(clock.ElapsedTicks * ProcessLoopbackCapture.SampleRate / Stopwatch.Frequency - produced, FramesPer10Ms * 4);
            if (due < FramesPer10Ms) { Thread.Sleep(2); continue; }
            Array.Clear(mix, 0, due * 2);
            foreach (var source in _sources.Values) source.MixInto(mix, due);
            for (var i = 0; i < due * 2; i++)
            {
                var sample = (short)Math.Clamp(mix[i], short.MinValue, short.MaxValue);
                output[i * 2] = (byte)sample;
                output[i * 2 + 1] = (byte)(sample >> 8);
            }
            onData(output.AsSpan(0, due * ProcessLoopbackCapture.BytesPerFrame));
            produced += due;
        }
    }

    public void Dispose()
    {
        foreach (var source in _sources.Values) source.Dispose();
        _sources.Clear();
    }

    /// <summary>Um programa capturado: thread própria lendo do Windows para um buffer que o mixer consome.</summary>
    private sealed class Source : IDisposable
    {
        private readonly ProcessLoopbackCapture _capture;
        private readonly Thread _thread;
        private readonly short[] _ring = new short[MaxFrames * 2 * 2];
        private int _read, _count; // em amostras (2 por quadro)
        private bool _primed;
        private volatile bool _stop;
        public string Name { get; }

        public Source(uint pid, string name)
        {
            Name = name;
            _capture = ProcessLoopbackCapture.Create(pid, ProcessLoopbackMode.IncludeTargetProcessTree);
            _thread = new Thread(() =>
            {
                try { _capture.Run(Append, () => _stop); }
                catch (COMException) { /* programa fechou: o próximo ciclo remove */ }
            }) { IsBackground = true, Name = $"captura {name}" };
            _thread.Start();
        }

        private void Append(ReadOnlySpan<byte> pcm)
        {
            var samples = MemoryMarshal.Cast<byte, short>(pcm);
            lock (_ring)
            {
                foreach (var sample in samples)
                {
                    if (_count == _ring.Length) { _read = (_read + 1) % _ring.Length; _count--; }
                    _ring[(_read + _count) % _ring.Length] = sample;
                    _count++;
                }
                // atrasou demais (ex.: o mixer travou): descarta o excesso e volta à folga normal
                if (_count > MaxFrames * 2) { var drop = _count - PrimeFrames * 2; _read = (_read + drop) % _ring.Length; _count -= drop; }
            }
        }

        public void MixInto(int[] mix, int frames)
        {
            lock (_ring)
            {
                if (!_primed && _count >= PrimeFrames * 2) _primed = true;
                if (!_primed) return;
                var take = Math.Min(_count, frames * 2);
                for (var i = 0; i < take; i++) mix[i] += _ring[(_read + i) % _ring.Length];
                _read = (_read + take) % _ring.Length;
                _count -= take;
                // esvaziou (programa parou de tocar): espera juntar folga de novo antes de voltar a misturar
                if (_count == 0) _primed = false;
            }
        }

        public void Dispose()
        {
            _stop = true;
            _thread.Join(500);
            _capture.Dispose();
        }
    }
}
