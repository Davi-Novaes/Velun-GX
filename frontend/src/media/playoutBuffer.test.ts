import { describe, expect, it } from 'vitest'
import { FreezeWindow, PLAYOUT_SMOOTHING_MS, smoothPlayout } from './playoutBuffer'

describe('Folga de reprodução de quem assiste', () => {
  it('aplica a folga no receptor que suporta jitterBufferTarget e ignora quem não suporta', () => {
    const receiver = { jitterBufferTarget: null as number | null } as unknown as RTCRtpReceiver
    smoothPlayout(receiver)
    expect((receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget).toBe(PLAYOUT_SMOOTHING_MS)
    expect(() => smoothPlayout({} as RTCRtpReceiver)).not.toThrow()
    expect(() => smoothPlayout(undefined)).not.toThrow()
  })

  it('conta só as travadas do último minuto e recomeça se o contador zerar', () => {
    const w = new FreezeWindow()
    expect(w.add(0, 0)).toBe(0)
    expect(w.add(20_000, 2)).toBe(2)
    expect(w.add(50_000, 3)).toBe(3)
    expect(w.add(80_000, 3)).toBe(1) // a amostra de 0 s saiu da janela; contava a partir de 2
    expect(w.add(90_000, 0)).toBe(0) // nova assinatura
  })
})
