import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './DownloadApp'

describe('isNewerVersion', () => {
  it('compara números, não texto', () => {
    expect(isNewerVersion('0.2.2', '0.2.1')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.3')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true)
  })

  it('versão igual ou mais antiga que a instalada não é atualização', () => {
    expect(isNewerVersion('0.2.0', '0.2.1')).toBe(false)
    expect(isNewerVersion('0.2.1', '0.2.1')).toBe(false)
  })
})
