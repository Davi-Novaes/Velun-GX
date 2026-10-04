import { describe, expect, it } from 'vitest'
import { LiveKitRoomClient } from './LiveKitRoomClient'

describe('Ativar o som de uma pessoa', () => {
  it('não tira o mudo de quem você silenciou (room.startAudio desmuta todos os elementos)', async () => {
    const client = new LiveKitRoomClient()
    const muted = document.createElement('audio'); muted.muted = true
    const alsoMuted = document.createElement('audio'); alsoMuted.muted = true
    const playing = document.createElement('audio')
    const internals = client as unknown as { room: unknown; attachedAudio: Map<HTMLAudioElement, unknown> }
    for (const element of [muted, alsoMuted, playing]) internals.attachedAudio.set(element, {})
    // o que o LiveKit faz: e.muted = false em todos, de forma síncrona, e depois play()
    internals.room = { startAudio: () => { for (const element of internals.attachedAudio.keys()) element.muted = false; return Promise.resolve() } }
    playing.muted = false
    await client.startAudio()
    expect(muted.muted).toBe(true)
    expect(alsoMuted.muted).toBe(true)
    expect(playing.muted).toBe(false)
  })
})
