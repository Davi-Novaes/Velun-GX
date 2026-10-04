import { afterEach, describe, expect, it } from 'vitest'
import { audioKeys, loadAudioMemory, rememberAudio, rememberedAudio, saveAudioMemory } from './audioMemory'

describe('volume/mudo lembrado por pessoa', () => {
  afterEach(() => localStorage.clear())

  it('quem você mutou continua mutado ao voltar a transmitir (mesma conta, nova sessão)', () => {
    let memory = rememberAudio({}, audioKeys('user-matt', 'Maatt'), { muted: true })
    saveAudioMemory(memory)
    memory = loadAudioMemory()
    expect(rememberedAudio(memory, audioKeys('user-matt', 'Maatt'))).toEqual({ muted: true, volume: 0.8 })
  })

  it('nos primeiros instantes (presença ainda sem a conta) reconhece pelo nome', () => {
    const memory = rememberAudio({}, audioKeys('user-matt', 'Maatt'), { volume: 0.25 })
    expect(rememberedAudio(memory, audioKeys(undefined, 'maatt'))).toEqual({ muted: false, volume: 0.25 })
  })

  it('a conta tem prioridade sobre o nome (apelido pode mudar)', () => {
    let memory = rememberAudio({}, audioKeys('user-a', 'Ana'), { volume: 0.3 })
    memory = rememberAudio(memory, audioKeys('user-b', 'Ana'), { volume: 0.9 })
    expect(rememberedAudio(memory, audioKeys('user-a', 'Ana'))!.volume).toBe(0.3)
  })

  it('ignora dados corrompidos', () => {
    localStorage.setItem('tj:streamAudio', '{"u:x":{"volume":7},"u:y":"oi"}')
    expect(loadAudioMemory()).toEqual({})
    localStorage.setItem('tj:streamAudio', 'não é json')
    expect(loadAudioMemory()).toEqual({})
  })
})
