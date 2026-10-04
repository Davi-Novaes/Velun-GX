import { afterEach, describe, expect, it } from 'vitest'
import { PCM_WORKLET, mutesOtherStreams, velunBridge } from './velun'

interface Processor {
  port: { onmessage: (event: { data: ArrayBuffer }) => void }
  size: number
  process(inputs: unknown, outputs: Float32Array[][]): boolean
}

/** Executa o código do worklet fora do AudioWorklet, com um registro falso. */
function loadProcessor(): Processor {
  let Ctor: (new () => Processor) | undefined
  class FakeProcessor { port = { onmessage: (_event: { data: ArrayBuffer }) => {} } }
  new Function('AudioWorkletProcessor', 'registerProcessor', PCM_WORKLET)(FakeProcessor, (_name: string, ctor: new () => Processor) => { Ctor = ctor })
  return new Ctor!()
}

function pcm(frames: number, value: number): ArrayBuffer {
  const data = new Int16Array(frames * 2)
  for (let i = 0; i < frames; i++) { data[i * 2] = value; data[i * 2 + 1] = -value }
  return data.buffer
}

function render(processor: Processor): Float32Array[] {
  const out = [new Float32Array(128), new Float32Array(128)]
  processor.process([], [out])
  return out
}

describe('Velun Gx', () => {
  afterEach(() => { delete (window as unknown as { velun?: unknown }).velun })

  it('com o som do PC sem o app (0.2.6+) você continua ouvindo os outros; só o modo reserva silencia', () => {
    expect(mutesOtherStreams('exclude-discord-and-app')).toBe(false)
    expect(mutesOtherStreams('window-app')).toBe(false)
    expect(mutesOtherStreams(undefined)).toBe(false)
    expect(mutesOtherStreams('exclude-discord')).toBe(true)
  })

  it('só ativa a integração dentro do app', () => {
    expect(velunBridge()).toBeNull()
    ;(window as unknown as { velun: unknown }).velun = { app: 'Velun Gx' }
    expect(velunBridge()).not.toBeNull()
  })

  it('espera ~40 ms de folga antes de tocar e converte PCM para estéreo', () => {
    const processor = loadProcessor()
    processor.port.onmessage({ data: pcm(960, 16384) }) // 20 ms: ainda abaixo da folga
    expect(render(processor)[0]!.every((x) => x === 0)).toBe(true)
    processor.port.onmessage({ data: pcm(960, 16384) }) // 40 ms
    const [left, right] = render(processor) as [Float32Array, Float32Array]
    expect(left[0]).toBeCloseTo(0.5)
    expect(right[0]).toBeCloseTo(-0.5)
  })

  it('descarta atraso acumulado em vez de ficar cada vez mais atrasado', () => {
    const processor = loadProcessor()
    for (let i = 0; i < 20; i++) processor.port.onmessage({ data: pcm(480, 1000) }) // 200 ms de uma vez
    expect(processor.size).toBeLessThanOrEqual(48000 * 0.16)
  })

  it('volta a esperar a folga depois de ficar sem som', () => {
    const processor = loadProcessor()
    processor.port.onmessage({ data: pcm(1920, 1000) })
    for (let i = 0; i < 16; i++) render(processor) // consome tudo
    processor.port.onmessage({ data: pcm(500, 1000) })
    expect(render(processor)[0]![0]).toBe(0)
  })
})

describe('Windows 10 no app', () => {
  it('som do PC inteiro silencia as outras transmissões para quem transmite (senão vira eco)', () => {
    expect(mutesOtherStreams('system-loopback')).toBe(true)
  })
})
