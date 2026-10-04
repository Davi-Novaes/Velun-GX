import { afterEach, describe, expect, it, vi } from 'vitest'
import { callSoundsFor, loadSoundPrefs, playSound, saveSoundPrefs } from './sounds'

describe('sons da call', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

  it('não toca nada no primeiro momento depois de conectar (quem já estava lá)', () => {
    expect(callSoundsFor(null, { participants: ['eu', 'ana', 'neguin'], shares: ['ana'] })).toEqual([])
  })

  it('toca entrada, saída, início e fim de transmissão', () => {
    const before = { participants: ['eu', 'ana'], shares: ['ana'] }
    expect(callSoundsFor(before, { participants: ['eu', 'ana', 'neguin'], shares: ['ana'] })).toEqual(['join'])
    expect(callSoundsFor(before, { participants: ['eu'], shares: [] })).toEqual(['leave', 'stream-stop'])
    expect(callSoundsFor(before, { participants: ['eu', 'ana'], shares: ['ana', 'eu'] })).toEqual(['stream-start'])
    expect(callSoundsFor(before, before)).toEqual([])
  })

  it('várias pessoas entrando juntas tocam o som uma vez só', () => {
    expect(callSoundsFor({ participants: ['eu'], shares: [] }, { participants: ['eu', 'a', 'b', 'c'], shares: [] })).toEqual(['join'])
  })

  it('respeita volume e "desligado", e guarda a preferência', () => {
    const play = vi.fn(async () => undefined)
    const created: { volume: number; src: string }[] = []
    vi.stubGlobal('Audio', class { volume = 1; constructor(public src: string) { created.push(this) } play = play })
    playSound('join', { enabled: false, volume: 0.5 })
    expect(play).not.toHaveBeenCalled()
    playSound('stream-start', { enabled: true, volume: 0.3 })
    expect(created[0]).toMatchObject({ src: '/sounds/stream-start.ogg', volume: 0.3 })
    saveSoundPrefs({ enabled: false, volume: 0.2 })
    expect(loadSoundPrefs()).toEqual({ enabled: false, volume: 0.2 })
  })
})
