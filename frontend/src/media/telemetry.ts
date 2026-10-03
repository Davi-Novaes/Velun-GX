import type { QualityChoice } from './presets'

/** Dados reportados pelo próprio emissor. Nunca usados para autorização. */
export interface StreamReport {
  quality?: QualityChoice
  captureWidth?: number
  captureHeight?: number
  sendWidth?: number
  sendHeight?: number
  fps?: number
  /** tamanho original da fonte, se a captura está travada e a versão do app de quem transmite */
  sourceWidth?: number
  sourceHeight?: number
  locked?: boolean
  app?: string
  rttMs?: number
  appPingMs?: number
  lossPercent?: number
  mbps?: number
  limitation?: string
}
export function readReport(value?: string): StreamReport | undefined {
  if (!value || value.length > 1500) return undefined
  try {
    const v = JSON.parse(value) as Record<string, unknown>
    if (!v || typeof v !== 'object') return undefined
    const number = (key: string, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= 0 && v[key] <= max ? v[key] : undefined
    const q = v.quality as QualityChoice | undefined
    return {
      quality: q && ['auto', 'original', '360p', '480p', '720p', '1080p', '1440p', '2160p'].includes(q.resolution) && [15, 30, 60].includes(q.fps) ? { resolution: q.resolution, fps: q.fps } : undefined,
      captureWidth: number('captureWidth', 16384), captureHeight: number('captureHeight', 16384),
      sendWidth: number('sendWidth', 16384), sendHeight: number('sendHeight', 16384), fps: number('fps', 240),
      sourceWidth: number('sourceWidth', 16384), sourceHeight: number('sourceHeight', 16384),
      locked: typeof v.locked === 'boolean' ? v.locked : undefined,
      app: typeof v.app === 'string' && v.app.length <= 40 ? v.app : undefined,
      rttMs: number('rttMs', 60000), appPingMs: number('appPingMs', 60000), lossPercent: number('lossPercent', 100), mbps: number('mbps', 1000),
      limitation: ['none', 'cpu', 'bandwidth', 'other'].includes(String(v.limitation)) ? String(v.limitation) : undefined,
    }
  } catch { return undefined }
}
