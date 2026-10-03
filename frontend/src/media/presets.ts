// Presets de qualidade do compartilhamento (Documento 1, §8).
// Na Fase 3 são usados como parâmetros iniciais de captura e codificação; a filtragem por capacidade
// do dispositivo/rede e o controle adaptativo entram na Fase 5.

export type ResolutionPreset = 'auto' | 'original' | '360p' | '480p' | '720p' | '1080p' | '1440p' | '2160p'
export type FpsPreset = 15 | 30 | 60

export const RESOLUTIONS: Record<Exclude<ResolutionPreset, 'auto' | 'original'>, { height: number; label: string }> = {
  '360p': { height: 360, label: '360p' },
  '480p': { height: 480, label: '480p' },
  '720p': { height: 720, label: '720p' },
  '1080p': { height: 1080, label: '1080p' },
  '1440p': { height: 1440, label: '1440p' },
  '2160p': { height: 2160, label: '4K' },
}

export const FPS_OPTIONS: ReadonlyArray<{ value: FpsPreset; label: string; hint: string }> = [
  { value: 15, label: '15 FPS', hint: 'pouco movimento' },
  { value: 30, label: '30 FPS', hint: 'apresentação' },
  { value: 60, label: '60 FPS', hint: 'jogos e vídeo' },
]

/** Teto de bitrate (kbps) da camada alta por altura e FPS. */
const BITRATE_KBPS: Record<number, Record<FpsPreset, number>> = {
  360: { 15: 300, 30: 500, 60: 800 },
  480: { 15: 500, 30: 800, 60: 1200 },
  720: { 15: 1800, 30: 3500, 60: 6000 },
  1080: { 15: 3500, 30: 8000, 60: 12000 },
  1440: { 15: 5000, 30: 10000, 60: 14000 },
  2160: { 15: 8000, 30: 14000, 60: 16000 },
}

/** "Automática" não passa de 1080p: acima disso o custo de codificação cresce muito para pouco ganho visível. */
const AUTO_MAX_HEIGHT = 1080

export interface QualityChoice {
  resolution: ResolutionPreset
  fps: FpsPreset
}

export const DEFAULT_QUALITY: QualityChoice = { resolution: 'auto', fps: 30 }

export interface EncodingPlan {
  /** Altura máxima de captura (a largura segue a proporção da fonte). */
  maxHeight: number
  fps: FpsPreset
  maxBitrateKbps: number
  contentHint: 'detail' | 'motion'
  degradationPreference: RTCDegradationPreference
  /** Camada baixa do simulcast (espectadores com rede ruim ou vídeo pequeno). */
  lowLayer: { height: number; fps: number; maxBitrateKbps: number }
}

export function planEncoding(choice: QualityChoice, limits: { maxHeight: number; maxFps: number; maxBitrateKbps: number }): EncodingPlan {
  const requestedHeight = choice.resolution === 'original' ? limits.maxHeight : choice.resolution === 'auto' ? AUTO_MAX_HEIGHT : RESOLUTIONS[choice.resolution].height
  const maxHeight = Math.min(requestedHeight, limits.maxHeight)
  const fps = Math.min(choice.fps, limits.maxFps) as FpsPreset
  const maxBitrateKbps = Math.min(bitrateFor(maxHeight, fps), limits.maxBitrateKbps)

  return {
    maxHeight,
    fps,
    maxBitrateKbps,
    // texto nítido para apresentação; fluidez para movimento
    contentHint: fps >= 60 ? 'motion' : 'detail',
    // Mantém texto e detalhes estáveis a 15/30 FPS; sob pressão reduz FPS antes da resolução.
    // Inclusive a 60 FPS: reduz quadros sob pressão antes de oscilar a resolução.
    degradationPreference: 'maintain-resolution',
    lowLayer: {
      height: Math.max(180, Math.min(360, Math.round(maxHeight / 2))),
      fps: Math.min(15, fps),
      maxBitrateKbps: Math.max(150, Math.round(maxBitrateKbps * 0.12)),
    },
  }
}

/** Bitrate para alturas fora da tabela: interpola pela área (pixels), a partir do degrau inferior. */
function bitrateFor(height: number, fps: FpsPreset): number {
  const heights = Object.keys(BITRATE_KBPS).map(Number).sort((a, b) => a - b)
  const exact = BITRATE_KBPS[height]
  if (exact) return exact[fps]
  const lower = [...heights].reverse().find((h) => h <= height) ?? heights[0]!
  return Math.round(BITRATE_KBPS[lower]![fps] * (height / lower) ** 2)
}

export function describeQuality(choice: QualityChoice): string {
  const res = choice.resolution === 'original' ? 'Original' : choice.resolution === 'auto' ? 'Automática' : RESOLUTIONS[choice.resolution].label
  return `${res} · ${choice.fps} FPS`
}
