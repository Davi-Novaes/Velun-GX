import { describe, expect, it } from 'vitest'
import { readReport } from './telemetry'
describe('telemetria enviada por participantes', () => {
  it('descarta formatos inválidos e valores fora dos limites', () => {
    expect(readReport('{broken')).toBeUndefined()
    expect(readReport('null')).toBeUndefined()
    expect(readReport(JSON.stringify({ rttMs: -1, fps: 9000, captureWidth: '1920', quality: { resolution: 'fake', fps: 30 }, limitation: '<script>' }))).toMatchObject({ rttMs: undefined, fps: undefined, captureWidth: undefined, quality: undefined, limitation: undefined })
  })
  it('separa configuração, captura e envio real', () => {
    const report = { quality: { resolution: '1080p', fps: 60 }, captureWidth: 1920, captureHeight: 1080, sendWidth: 1280, sendHeight: 720, fps: 28, rttMs: 35, appPingMs: 48, limitation: 'bandwidth' }
    expect(readReport(JSON.stringify(report))).toMatchObject(report)
  })
})
