using System.Runtime.InteropServices;

namespace VelunAudio;

/// <summary>
/// Captura o som do PC por processo: no modo Exclude, entrega tudo o que toca no computador
/// MENOS o processo alvo e os processos abertos por ele (a "árvore" do Discord inteira).
/// Formato fixo: PCM 16 bits, 48 kHz, estéreo (o Windows converte do formato do dispositivo).
/// </summary>
internal sealed class ProcessLoopbackCapture : IDisposable
{
    public const int SampleRate = 48000;
    public const int Channels = 2;
    public const int BytesPerFrame = Channels * 2;

    private static readonly Guid IAudioClientId = new("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
    private static readonly Guid IAudioCaptureClientId = new("C8ADBD64-E71E-48A0-A4DE-185C395CD317");

    private readonly IAudioClient _client;
    private readonly IAudioCaptureClient _capture;
    private readonly IntPtr _event;
    private bool _started;

    private ProcessLoopbackCapture(IAudioClient client, IAudioCaptureClient capture, IntPtr evt)
    {
        _client = client;
        _capture = capture;
        _event = evt;
    }

    public static ProcessLoopbackCapture Create(uint targetProcessId, ProcessLoopbackMode mode)
    {
        var client = Activate(targetProcessId, mode);

        var format = new WaveFormatEx
        {
            FormatTag = 1, // PCM
            Channels = Channels,
            SamplesPerSec = SampleRate,
            BitsPerSample = 16,
            BlockAlign = BytesPerFrame,
            AvgBytesPerSec = SampleRate * BytesPerFrame,
            Size = 0,
        };
        var formatPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatEx>());
        try
        {
            Marshal.StructureToPtr(format, formatPtr, false);
            // 20 ms de buffer: baixa latência sem cortar o som
            client.Initialize(0, Native.StreamFlagsLoopback | Native.StreamFlagsEventCallback | Native.StreamFlagsAutoConvertPcm | Native.StreamFlagsSrcDefaultQuality,
                200_000, 0, formatPtr, IntPtr.Zero);
        }
        finally
        {
            Marshal.FreeHGlobal(formatPtr);
        }

        var evt = Native.CreateEventW(IntPtr.Zero, false, false, IntPtr.Zero);
        client.SetEventHandle(evt);
        var captureId = IAudioCaptureClientId;
        client.GetService(ref captureId, out var service);
        return new ProcessLoopbackCapture(client, (IAudioCaptureClient)service, evt);
    }

    /// <summary>Lê pacotes até <paramref name="stop"/>; cada bloco de PCM vai para <paramref name="onData"/>.</summary>
    public void Run(Action<ReadOnlySpan<byte>> onData, Func<bool> stop)
    {
        _client.Start();
        _started = true;
        var silence = new byte[SampleRate / 100 * BytesPerFrame];
        while (!stop())
        {
            // sem som tocando, o Windows pode não entregar pacotes: o lado do app completa com silêncio
            if (Native.WaitForSingleObject(_event, 100) != 0) continue;
            _capture.GetNextPacketSize(out var frames);
            while (frames > 0)
            {
                _capture.GetBuffer(out var data, out var count, out var flags, out _, out _);
                var bytes = (int)count * BytesPerFrame;
                if ((flags & Native.BufferFlagsSilent) != 0 || data == IntPtr.Zero)
                {
                    if (silence.Length < bytes) silence = new byte[bytes];
                    onData(silence.AsSpan(0, bytes));
                }
                else
                {
                    unsafe { onData(new ReadOnlySpan<byte>((void*)data, bytes)); }
                }
                _capture.ReleaseBuffer(count);
                _capture.GetNextPacketSize(out frames);
            }
        }
    }

    public void Dispose()
    {
        if (_started) { try { _client.Stop(); } catch (COMException) { } }
        Native.CloseHandle(_event);
        Marshal.ReleaseComObject(_capture);
        Marshal.ReleaseComObject(_client);
    }

    private static IAudioClient Activate(uint targetProcessId, ProcessLoopbackMode mode)
    {
        var parameters = new AudioClientActivationParams { ActivationType = 1, TargetProcessId = targetProcessId, ProcessLoopbackMode = mode };
        var paramsPtr = Marshal.AllocHGlobal(Marshal.SizeOf<AudioClientActivationParams>());
        var variantPtr = Marshal.AllocHGlobal(Marshal.SizeOf<PropVariantBlob>());
        try
        {
            Marshal.StructureToPtr(parameters, paramsPtr, false);
            Marshal.StructureToPtr(new PropVariantBlob { Vt = 65 /* VT_BLOB */, Size = (uint)Marshal.SizeOf<AudioClientActivationParams>(), Data = paramsPtr }, variantPtr, false);
            var handler = new CompletionHandler();
            var iid = IAudioClientId;
            Native.ActivateAudioInterfaceAsync(Native.ProcessLoopbackDevice, ref iid, variantPtr, handler, out _);
            if (!handler.Done.Wait(TimeSpan.FromSeconds(5)))
                throw new TimeoutException("O Windows não respondeu à ativação da captura de áudio.");
            if (handler.Result < 0)
                Marshal.ThrowExceptionForHR(handler.Result);
            return (IAudioClient)handler.Client!;
        }
        finally
        {
            Marshal.FreeHGlobal(variantPtr);
            Marshal.FreeHGlobal(paramsPtr);
        }
    }

    [ComVisible(true)]
    private sealed class CompletionHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public ManualResetEventSlim Done { get; } = new();
        public int Result { get; private set; }
        public object? Client { get; private set; }

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try
            {
                activateOperation.GetActivateResult(out var hr, out var client);
                Result = hr;
                Client = client;
            }
            catch (COMException ex)
            {
                Result = ex.HResult;
            }
            finally
            {
                Done.Set();
            }
        }
    }
}
