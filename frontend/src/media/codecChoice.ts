// Escolha do formato de vídeo de quem transmite.
// - H.264 pela placa de vídeo (NVENC/AMF/QuickSync): só se a pessoa ativar "Aceleração de hardware".
// - Senão, VP9 (melhor imagem, mais processador) ou VP8 (leve), conforme um teste rápido do processador
//   desta máquina, e o que o app aprendeu nas transmissões anteriores (processador no limite → VP8).

import type { EncodingPlan } from './presets'

export type VideoCodecChoice = 'h264' | 'vp9' | 'vp8'

export interface CodecDecision {
  codec: VideoCodecChoice
  /** Por que esse formato (aparece em "Informações da transmissão"). */
  reason: string
}

export interface EncoderBenchmark {
  /** Quadros 1080p por segundo que o processador codifica em cada formato (tempo real). */
  vp9: number
  vp8: number
  cores: number
  at: number
}

const BENCH_KEY = 'tj:encoderBench'
const HW_KEY = 'tj:h264Hardware'
const VP9_HEAVY_KEY = 'tj:vp9TooHeavy'
const HW_PREF_KEY = 'tj:hardwareEncoding'
const BENCH_MAX_AGE = 14 * 24 * 3600 * 1000
/** VP9 só com folga: além da transmissão, o PC está rodando o jogo. */
export const VP9_HEADROOM = 1.8

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* sem armazenamento */ }
}

export function hardwareEncodingPreferred(): boolean {
  return read(HW_PREF_KEY) === '1'
}
export function setHardwareEncodingPreferred(on: boolean): void {
  write(HW_PREF_KEY, on ? '1' : '0')
}

/** A placa de vídeo deste PC codifica H.264? undefined = ainda não testado numa transmissão. */
export function h264HardwareKnown(): boolean | undefined {
  const value = read(HW_KEY)
  return value === 'yes' ? true : value === 'no' ? false : undefined
}
export function rememberH264Hardware(available: boolean): void {
  write(HW_KEY, available ? 'yes' : 'no')
}

/** Uma transmissão em VP9 deixou o processador no limite: as próximas começam em VP8. */
export function rememberVp9TooHeavy(): void {
  write(VP9_HEAVY_KEY, String(Date.now()))
}
function vp9TooHeavy(): boolean {
  const at = Number(read(VP9_HEAVY_KEY) ?? 0)
  return at > 0 && Date.now() - at < BENCH_MAX_AGE
}

export function cachedBenchmark(): EncoderBenchmark | null {
  try {
    const value = JSON.parse(read(BENCH_KEY) ?? 'null') as EncoderBenchmark | null
    if (!value || typeof value.vp9 !== 'number' || typeof value.vp8 !== 'number') return null
    if (Date.now() - value.at > BENCH_MAX_AGE || value.cores !== (navigator.hardwareConcurrency || 0)) return null
    return value
  } catch {
    return null
  }
}

/** Quadros por segundo que o VP9 precisa entregar (em equivalente 1080p) para essa qualidade, já com a folga. */
export function requiredVp9Fps(plan: Pick<EncodingPlan, 'maxHeight' | 'fps'>): number {
  const pixels = Math.min(plan.maxHeight, 2160) ** 2 / 1080 ** 2
  return plan.fps * pixels * VP9_HEADROOM
}

export function chooseCodec(
  plan: Pick<EncodingPlan, 'maxHeight' | 'fps'>,
  options: { hardware: boolean },
  bench: EncoderBenchmark | null = cachedBenchmark(),
  hardwareKnown: boolean | undefined = h264HardwareKnown(),
  heavy: boolean = vp9TooHeavy(),
): CodecDecision {
  if (options.hardware && hardwareKnown !== false) return { codec: 'h264', reason: 'Aceleração de hardware ativada' }
  const prefix = options.hardware ? 'Placa de vídeo sem codificador H.264 · ' : ''
  if (heavy) return { codec: 'vp8', reason: `${prefix}VP9 deixou o processador no limite antes` }
  if (!bench) return { codec: 'vp8', reason: `${prefix}Processador ainda não testado` }
  const needed = requiredVp9Fps(plan)
  return bench.vp9 >= needed
    ? { codec: 'vp9', reason: `${prefix}Processador com folga (${bench.vp9} quadros/s em VP9)` }
    : { codec: 'vp8', reason: `${prefix}Processador sem folga para VP9 (${bench.vp9} de ${Math.round(needed)} quadros/s)` }
}

let running: Promise<EncoderBenchmark | null> | null = null

/**
 * Teste do processador (~1 s): codifica quadros 1080p com textura de jogo em VP9 e VP8 (WebCodecs, tempo real).
 * Roda uma vez quando a janela de compartilhar abre; o resultado fica guardado por duas semanas.
 */
export function runEncoderBenchmark(force = false): Promise<EncoderBenchmark | null> {
  if (!force) {
    const cached = cachedBenchmark()
    if (cached) return Promise.resolve(cached)
  }
  running ??= measure().then((result) => {
    if (result) write(BENCH_KEY, JSON.stringify(result))
    return result
  }).catch(() => null).finally(() => { running = null })
  return running
}

async function measure(): Promise<EncoderBenchmark | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  const W = 1920, H = 1080
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d')
  if (!g) return null
  const frames: ImageBitmap[] = []
  for (let f = 0; f < 4; f++) {
    // gradiente escuro com granulado: o caso mais difícil (cenas escuras de jogo)
    const image = g.createImageData(W, H)
    for (let i = 0; i < image.data.length; i += 4) {
      const v = (Math.random() * 50 + ((i / 4) % W) / W * 110 + f * 6) | 0
      image.data[i] = v; image.data[i + 1] = (v * 0.9) | 0; image.data[i + 2] = (v * 0.8) | 0; image.data[i + 3] = 255
    }
    g.putImageData(image, 0, 0)
    frames.push(await createImageBitmap(canvas))
  }
  const run = async (codec: string, count: number): Promise<number> => {
    let done = 0
    let failure: unknown
    const encoder = new VideoEncoder({ output: () => { done++ }, error: (e) => { failure = e } })
    encoder.configure({ codec, width: W, height: H, bitrate: 12_000_000, framerate: 60, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' })
    const start = performance.now()
    for (let i = 0; i < count; i++) {
      const frame = new VideoFrame(frames[i % frames.length]!, { timestamp: i * 16_667 })
      encoder.encode(frame, { keyFrame: i === 0 })
      frame.close()
      if (encoder.encodeQueueSize > 4) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }))
    }
    await encoder.flush()
    const seconds = (performance.now() - start) / 1000
    encoder.close()
    if (failure) throw failure
    return Math.round(done / seconds)
  }
  try {
    const vp9 = await run('vp09.00.10.08', 60)
    const vp8 = await run('vp8', 45)
    return { vp9, vp8, cores: navigator.hardwareConcurrency || 0, at: Date.now() }
  } finally {
    frames.forEach((f) => f.close())
  }
}

/** "H.264 · placa de vídeo (NVIDIA H.264 Encoder MFT)" / "VP9 · processador" */
export function describeEncoder(codec: string | undefined, implementation: string | undefined, hardware: boolean | undefined): string {
  if (!codec) return 'Não informado'
  const name = codec.replace(/^video\//i, '').toUpperCase().replace('H264', 'H.264')
  const where = hardware === undefined ? '' : hardware ? ' · placa de vídeo' : ' · processador'
  const detail = implementation && hardware ? ` (${implementation.replace(/^MediaFoundationVideoEncodeAccelerator\s*\(?|\)$/g, '').trim() || implementation})` : ''
  return `${name}${where}${detail}`
}
