import { describe, expect, it } from 'vitest'
import { audioPath } from './LiveKitScreenShare'

describe('de onde vem o som da transmissão', () => {
  it('navegador comum: o próprio navegador entrega', () => {
    expect(audioPath(true, false, undefined, false)).toBe('browser')
  })
  it('app no Windows 11 (ou verificação ainda em andamento): componente nativo, sem Discord e sem o app', () => {
    expect(audioPath(true, true, true, false)).toBe('helper')
    expect(audioPath(true, true, undefined, false)).toBe('helper')
  })
  it('app no Windows 10: só com o som do PC aceito pela pessoa', () => {
    expect(audioPath(true, true, false, false)).toBe('pc-blocked')
    expect(audioPath(true, true, false, true)).toBe('pc-loopback')
  })
  it('sem áudio pedido, nada', () => {
    expect(audioPath(false, true, false, true)).toBe('none')
  })
})
