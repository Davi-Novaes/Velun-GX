import { describe, expect, it } from 'vitest'
import { displayMediaOptions, fitCapture } from './LiveKitScreenShare'
import { planEncoding } from './presets'
import type { ShareOptions } from './RoomClient'

const plan = planEncoding({ resolution: '1080p', fps: 30 }, { maxHeight: 2160, maxFps: 60, maxBitrateKbps: 16000 })
const base: ShareOptions = { surface: 'monitor', audio: true, audioScope: 'shared', resolution: '1080p', fps: 30 }

type Options = Record<string, unknown> & { audio: false | Record<string, unknown>; video: Record<string, unknown> }
const build = (options: ShareOptions, audio = options.audio) => displayMediaOptions(options, plan, audio) as unknown as Options

describe('opções do getDisplayMedia', () => {
  it('tela inteira oferece áudio do sistema por padrão, sem processar como voz', () => {
    const o = build(base)
    expect(o.systemAudio).toBe('include')
    expect(o.windowAudio).toBe('window')
    expect(o.audio).toMatchObject({ restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  })

  it('janela solicita somente áudio daquele aplicativo', () => {
    const o = build({ ...base, surface: 'window' })
    expect(o.systemAudio).toBe('exclude')
    expect(o.windowAudio).toBe('window')
  })

  it('"todo o som do computador": inclui o áudio do sistema também para janelas', () => {
    const o = build({ ...base, audioScope: 'system' })
    expect(o.systemAudio).toBe('include')
    expect(o.windowAudio).toBe('system')
  })

  it('sem áudio: não pede nenhum som', () => {
    const o = build({ ...base, audio: false }, false)
    expect(o.audio).toBe(false)
    expect(o.systemAudio).toBe('exclude')
    expect(o.windowAudio).toBe('exclude')
  })

  it('limita só a altura (a proporção da tela é preservada) e não deixa compartilhar a própria aba', () => {
    const o = build(base)
    expect(o.video).toMatchObject({ displaySurface: 'monitor' })
    expect(o.video).not.toHaveProperty('height')
    expect(o.video).not.toHaveProperty('width')
    expect(o.selfBrowserSurface).toBe('exclude')
  })
})

describe('redução proporcional da captura', () => {
  it('preserva 1920x1080 e reduz 4K para Full HD', () => {
    expect(fitCapture(1920, 1080, 1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(fitCapture(3840, 2160, 1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })
  it('não estica uma janela quadrada ou fonte menor', () => {
    expect(fitCapture(1080, 1080, 1920, 1080)).toEqual({ width: 1080, height: 1080 })
    expect(fitCapture(1280, 720, 1920, 1080)).toEqual({ width: 1280, height: 720 })
  })
})

describe('tamanho de captura travado (não deixa o Chrome reduzir sozinho)', () => {
  it('pede tamanho exato e FPS só com teto', async () => {
    const { lockedCaptureConstraints } = await import('./LiveKitScreenShare')
    expect(lockedCaptureConstraints({ width: 1920, height: 1080 }, 60)).toEqual({
      width: { min: 1920, ideal: 1920, max: 1920 },
      height: { min: 1080, ideal: 1080, max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
  })

  it('se o navegador recusar o tamanho exato, volta ao modo com teto (sem derrubar a transmissão)', async () => {
    const { applyCaptureSize } = await import('./LiveKitScreenShare')
    const calls: MediaTrackConstraints[] = []
    const track = {
      applyConstraints: async (c: MediaTrackConstraints) => {
        calls.push(c)
        if ((c.width as ConstrainULongRange).min !== undefined) throw new DOMException('x', 'OverconstrainedError')
      },
    } as unknown as MediaStreamTrack

    expect(await applyCaptureSize(track, { width: 1920, height: 1080 }, 60, 16 / 9)).toBe('flexible')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ width: { ideal: 1920, max: 1920 }, aspectRatio: { ideal: 16 / 9 } })
  })

  it('quando aceito, fica travado na primeira tentativa', async () => {
    const { applyCaptureSize } = await import('./LiveKitScreenShare')
    let count = 0
    const track = { applyConstraints: async () => { count++ } } as unknown as MediaStreamTrack
    expect(await applyCaptureSize(track, { width: 1280, height: 720 }, 30)).toBe('locked')
    expect(count).toBe(1)
  })
})

describe('fonte informada com altura errada (caso real: 2560×1920 numa tela 2560×1440)', () => {
  /** Simula o Chrome: getSettings começa com 4:3 errado; a captura real é 16:9 e cabe no retângulo pedido. */
  function fakeTrack(real: { width: number; height: number }, reported: { width: number; height: number }) {
    let current = { ...reported }
    const applied: MediaTrackConstraints[] = []
    const track = {
      getSettings: () => ({ ...current, frameRate: 60 }),
      applyConstraints: async (c: MediaTrackConstraints) => {
        applied.push(c)
        const maxW = (c.width as ConstrainULongRange).max!, maxH = (c.height as ConstrainULongRange).max!
        const scale = Math.min(1, maxW / real.width, maxH / real.height)
        current = { width: Math.round(real.width * scale), height: Math.round(real.height * scale) }
      },
    } as unknown as MediaStreamTrack
    return { track, applied, delivered: () => current }
  }

  it('corrige pela proporção real e entrega 1920×1080 em 1080p', async () => {
    const { fitCaptureToSource } = await import('./LiveKitScreenShare')
    const { track, applied, delivered } = fakeTrack({ width: 2560, height: 1440 }, { width: 2560, height: 1920 })
    const plan = planEncoding({ resolution: '1080p', fps: 60 }, { maxHeight: 2160, maxFps: 60, maxBitrateKbps: 16000 })

    const source = await fitCaptureToSource(track, { ...base, resolution: '1080p', fps: 60 }, plan, { maxWidth: 3840, maxHeight: 2160 })

    expect(source).toEqual({ width: 2560, height: 1440 })
    expect(delivered()).toEqual({ width: 1920, height: 1080 })
    // primeira tentativa (com a altura errada) pedia 1440×1080; a correção trava em 1920×1080
    expect((applied.at(-1)!.width as ConstrainULongRange).min).toBe(1920)
    expect((applied.at(-1)!.height as ConstrainULongRange).min).toBe(1080)
  })

  it('com a fonte informada corretamente, aplica uma vez só', async () => {
    const { fitCaptureToSource } = await import('./LiveKitScreenShare')
    const { track, applied, delivered } = fakeTrack({ width: 2560, height: 1440 }, { width: 2560, height: 1440 })
    const plan = planEncoding({ resolution: '1080p', fps: 60 }, { maxHeight: 2160, maxFps: 60, maxBitrateKbps: 16000 })

    await fitCaptureToSource(track, { ...base, resolution: '1080p', fps: 60 }, plan, { maxWidth: 3840, maxHeight: 2160 })

    expect(applied).toHaveLength(1)
    expect(delivered()).toEqual({ width: 1920, height: 1080 })
  })

  it('tela ultrawide (3440×1440) em 1080p mantém a proporção', async () => {
    const { captureTarget } = await import('./LiveKitScreenShare')
    const plan = planEncoding({ resolution: '1080p', fps: 60 }, { maxHeight: 2160, maxFps: 60, maxBitrateKbps: 16000 })
    expect(captureTarget({ width: 3440, height: 1440 }, { ...base, resolution: '1080p', fps: 60 }, plan, { maxWidth: 3840, maxHeight: 2160 })).toEqual({ width: 1920, height: 802 })
  })
})
