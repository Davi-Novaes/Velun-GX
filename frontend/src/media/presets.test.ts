import { describe, expect, it } from 'vitest'
import { pickFocus } from '../store/roomSession'
import { share } from '../test/fakes'
import { planEncoding } from './presets'
import { toShareError } from './RoomClient'

const noLimits = { maxHeight: 2160, maxFps: 60, maxBitrateKbps: 16000 }

describe('planEncoding', () => {
  it('1080p30 para apresentação: texto nítido, mantém resolução', () => {
    const plan = planEncoding({ resolution: '1080p', fps: 30 }, noLimits)
    expect(plan).toMatchObject({ maxHeight: 1080, fps: 30, maxBitrateKbps: 8000, contentHint: 'detail', degradationPreference: 'maintain-resolution' })
    expect(plan.lowLayer).toEqual({ height: 360, fps: 15, maxBitrateKbps: 960 })
  })

  it('60 FPS mantém resolução estável e permite reduzir FPS sob pressão', () => {
    const plan = planEncoding({ resolution: '720p', fps: 60 }, noLimits)
    expect(plan).toMatchObject({ maxBitrateKbps: 6000, contentHint: 'motion', degradationPreference: 'maintain-resolution' })
  })

  it('automática fica em até 1080p e prioriza resolução estável', () => {
    expect(planEncoding({ resolution: 'auto', fps: 30 }, noLimits)).toMatchObject({ maxHeight: 1080, degradationPreference: 'maintain-resolution' })
  })

  it('respeita os tetos da política do servidor', () => {
    const plan = planEncoding({ resolution: '2160p', fps: 60 }, { maxHeight: 1080, maxFps: 30, maxBitrateKbps: 2500 })
    expect(plan).toMatchObject({ maxHeight: 1080, fps: 30, maxBitrateKbps: 2500 })
  })

  it('camada baixa nunca fica abaixo de 180p nem de 150 kbps', () => {
    expect(planEncoding({ resolution: '360p', fps: 15 }, noLimits).lowLayer).toEqual({ height: 180, fps: 15, maxBitrateKbps: 150 })
  })
})

describe('pickFocus', () => {
  it('novo compartilhamento de outra pessoa ganha o palco', () => {
    expect(pickFocus('a', [share({ id: 'a' })], [share({ id: 'a' }), share({ id: 'b' })])).toBe('b')
  })

  it('mantém o foco escolhido enquanto ele existir', () => {
    const list = [share({ id: 'a' }), share({ id: 'b' })]
    expect(pickFocus('a', list, list)).toBe('a')
  })

  it('o próprio compartilhamento não rouba o palco de quem já está transmitindo', () => {
    expect(pickFocus('a', [share({ id: 'a' })], [share({ id: 'a' }), share({ id: 'me', isLocal: true })])).toBe('a')
  })

  it('quando o foco some, vai para outra transmissão remota, depois para a própria', () => {
    expect(pickFocus('a', [share({ id: 'a' })], [share({ id: 'me', isLocal: true }), share({ id: 'b' })])).toBe('b')
    expect(pickFocus('a', [share({ id: 'a' })], [share({ id: 'me', isLocal: true })])).toBe('me')
    expect(pickFocus('a', [share({ id: 'a' })], [])).toBeNull()
  })
})

describe('toShareError', () => {
  it.each([
    ['NotAllowedError', 'cancelled'],
    ['NotReadableError', 'failed'],
    ['NotSupportedError', 'unsupported'],
    ['SecurityError', 'denied'],
    ['Weird', 'failed'],
  ])('%s → %s', (name, kind) => {
    expect(toShareError(new DOMException('x', name)).kind).toBe(kind)
  })
})
