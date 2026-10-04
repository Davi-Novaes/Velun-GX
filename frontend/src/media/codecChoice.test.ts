import { afterEach, describe, expect, it } from 'vitest'
import { chooseCodec, describeEncoder, requiredVp9Fps, type EncoderBenchmark } from './codecChoice'

const plan1080p60 = { maxHeight: 1080, fps: 60 as const }
const bench = (vp9: number): EncoderBenchmark => ({ vp9, vp8: vp9 * 1.2, cores: 8, at: Date.now() })

describe('escolha do formato de vídeo', () => {
  afterEach(() => localStorage.clear())

  it('aceleração de hardware ativada usa H.264 pela placa', () => {
    expect(chooseCodec(plan1080p60, { hardware: true }, bench(10), undefined, false).codec).toBe('h264')
  })

  it('sem codificador na placa, cai para a escolha automática e explica', () => {
    const d = chooseCodec(plan1080p60, { hardware: true }, bench(200), false, false)
    expect(d.codec).toBe('vp9')
    expect(d.reason).toMatch(/Placa de vídeo sem codificador/)
  })

  it('processador com folga usa VP9; sem folga (ex.: Xeon antigo jogando) usa VP8', () => {
    expect(requiredVp9Fps(plan1080p60)).toBeCloseTo(108)
    expect(chooseCodec(plan1080p60, { hardware: false }, bench(120), undefined, false).codec).toBe('vp9')
    expect(chooseCodec(plan1080p60, { hardware: false }, bench(60), undefined, false).codec).toBe('vp8')
    // 720p30 exige bem menos: o mesmo PC fraco aguenta VP9
    expect(chooseCodec({ maxHeight: 720, fps: 30 }, { hardware: false }, bench(60), undefined, false).codec).toBe('vp9')
  })

  it('sem teste ainda, ou se o VP9 já pesou antes, fica no VP8', () => {
    expect(chooseCodec(plan1080p60, { hardware: false }, null, undefined, false).codec).toBe('vp8')
    expect(chooseCodec(plan1080p60, { hardware: false }, bench(500), undefined, true).codec).toBe('vp8')
  })

  it('descreve o codificador para o painel de informações', () => {
    expect(describeEncoder('video/H264', 'MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)', true)).toBe('H.264 · placa de vídeo (NVIDIA H.264 Encoder MFT)')
    expect(describeEncoder('video/VP9', 'libvpx', false)).toBe('VP9 · processador')
    expect(describeEncoder(undefined, undefined, undefined)).toBe('Não informado')
  })
})
