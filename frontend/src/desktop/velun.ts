// Integração com o app desktop Velun Gx (Windows). No navegador comum, window.velun não existe e nada daqui roda.

export type DesktopAudioMode = 'exclude-discord' | 'window-app'

export interface VelunBridge {
  app: 'Velun Gx'
  version: string
  selectedSource(): Promise<{ id: string; name: string; kind: 'screen' | 'window' } | null>
  /** Ausente em versões antigas do app (0.1.0). */
  update?: {
    status(): Promise<{ version: string } | null>
    onReady(callback: (update: { version: string }) => void): () => void
    install(): Promise<boolean>
    /** Ausentes antes da 0.2.3. */
    progress?(): Promise<{ version: string; percent: number } | null>
    onProgress?(callback: (progress: { version: string; percent: number }) => void): () => void
  }
  audio: {
    probe(): Promise<{ supported: boolean; message?: string }>
    start(scope: 'shared' | 'system'): Promise<{ mode: DesktopAudioMode }>
    stop(): Promise<void>
    onData(callback: (chunk: Uint8Array) => void): () => void
    onStatus(callback: (status: { event: string; data: Record<string, unknown> }) => void): () => void
  }
}

export function velunBridge(): VelunBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { velun?: VelunBridge }).velun
  return bridge?.app === 'Velun Gx' ? bridge : null
}

export interface DesktopAudio {
  track: MediaStreamTrack
  mode: DesktopAudioMode
  stop(): void
}

const SAMPLE_RATE = 48000

/**
 * Toca o PCM (16 bits, 48 kHz, estéreo) que chega do app num buffer curto e devolve como faixa de áudio.
 * ~40 ms de folga contra variação de entrega; se acumular atraso (> 160 ms), descarta o excesso.
 */
export const PCM_WORKLET = `
const TARGET = ${SAMPLE_RATE * 0.04}
const MAX = TARGET * 4
class VelunPcm extends AudioWorkletProcessor {
  constructor() {
    super()
    this.cap = ${SAMPLE_RATE}
    this.left = new Float32Array(this.cap)
    this.right = new Float32Array(this.cap)
    this.write = 0; this.read = 0; this.size = 0; this.primed = false
    this.port.onmessage = (event) => {
      const pcm = new Int16Array(event.data)
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        if (this.size === this.cap) { this.read = (this.read + 1) % this.cap; this.size-- }
        this.left[this.write] = pcm[i] / 32768
        this.right[this.write] = pcm[i + 1] / 32768
        this.write = (this.write + 1) % this.cap
        this.size++
      }
      if (this.size > MAX) { const drop = this.size - TARGET; this.read = (this.read + drop) % this.cap; this.size -= drop }
    }
  }
  process(_inputs, outputs) {
    const left = outputs[0][0], right = outputs[0][1] ?? outputs[0][0]
    if (!this.primed && this.size >= TARGET) this.primed = true
    for (let i = 0; i < left.length; i++) {
      if (this.primed && this.size > 0) {
        left[i] = this.left[this.read]; right[i] = this.right[this.read]
        this.read = (this.read + 1) % this.cap; this.size--
      } else {
        left[i] = 0; right[i] = 0
        if (this.size === 0) this.primed = false
      }
    }
    return true
  }
}
registerProcessor('velun-pcm', VelunPcm)
`

/** Liga o som do PC (sem o Discord, ou só do app da janela) e devolve a faixa pronta para publicar. */
export async function startDesktopAudio(bridge: VelunBridge, scope: 'shared' | 'system'): Promise<DesktopAudio> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  const moduleUrl = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'text/javascript' }))
  const unsubscribe: Array<() => void> = []
  try {
    await context.audioWorklet.addModule(moduleUrl)
    const node = new AudioWorkletNode(context, 'velun-pcm', { numberOfInputs: 0, outputChannelCount: [2] })
    const destination = context.createMediaStreamDestination()
    destination.channelCount = 2
    node.connect(destination) // não vai para os alto-falantes: só para a transmissão

    unsubscribe.push(bridge.audio.onData((chunk) => {
      const copy = chunk.slice() // buffer próprio, alinhado, transferível
      node.port.postMessage(copy.buffer, [copy.buffer])
    }))
    const { mode } = await bridge.audio.start(scope)
    await context.resume()
    const track = destination.stream.getAudioTracks()[0]
    if (!track) throw new Error('O áudio do app não gerou uma faixa.')
    let stopped = false
    return {
      track,
      mode,
      stop() {
        if (stopped) return
        stopped = true
        for (const off of unsubscribe) off()
        void bridge.audio.stop().catch(() => undefined)
        track.stop()
        node.disconnect()
        void context.close().catch(() => undefined)
      },
    }
  } catch (error) {
    for (const off of unsubscribe) off()
    void bridge.audio.stop().catch(() => undefined)
    void context.close().catch(() => undefined)
    throw error
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }
}
