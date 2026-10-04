import { describe, expect, it } from 'vitest'
import { senderLossPercent } from '../../media/LiveKitRoomClient'
import { NETWORK_LABEL, networkLevel } from './network'

describe('cor do indicador de conexão', () => {
  it.each([
    [3, 'good'],
    [18, 'good'],
    [49, 'good'],
    [50, 'fair'],
    [149, 'fair'],
    [150, 'poor'],
    [900, 'poor'],
  ] as const)('%i ms → %s', (ms, level) => {
    expect(networkLevel(ms, 0)).toBe(level)
  })

  it('perda pequena não deixa amarelo com ping baixo; perda relevante sim', () => {
    expect(networkLevel(18, 1)).toBe('good')
    expect(networkLevel(18, 5)).toBe('fair')
    expect(networkLevel(18, 15)).toBe('poor')
  })

  it('sem medição, fica neutro', () => {
    expect(networkLevel(undefined, 50)).toBe('unknown')
    expect(NETWORK_LABEL.good).toBe('Conexão boa')
  })
})

describe('perda de pacotes no envio', () => {
  it('usa a fração recente informada pelo servidor', () => {
    expect(senderLossPercent({ fractionLost: 0.004, packetsLost: 3 }, 1000, 3)).toBeCloseTo(0.4)
  })

  it('um pacote perdido não vira 100% (bug anterior)', () => {
    expect(senderLossPercent({ packetsLost: 1 }, 5000, 1)).toBeCloseTo(0.02)
  })

  it('sem relatório do servidor, não informa', () => {
    expect(senderLossPercent(undefined, 1000, 0)).toBeUndefined()
  })
})
