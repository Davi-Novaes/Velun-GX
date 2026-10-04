import type { ShareOptions } from '../../media/RoomClient'
import type { FpsPreset, ResolutionPreset } from '../../media/presets'

const PREFS_KEY = 'tj:shareQuality'

/** Última resolução/FPS escolhida, para a próxima transmissão já começar igual. */
export function loadQualityChoice(fallback: ShareOptions): ShareOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ShareOptions> | null
    const resolutions: ResolutionPreset[] = ['original', 'auto', '360p', '480p', '720p', '1080p', '1440p', '2160p']
    return {
      ...fallback,
      resolution: saved?.resolution && resolutions.includes(saved.resolution) ? saved.resolution : fallback.resolution,
      fps: saved?.fps === 15 || saved?.fps === 30 || saved?.fps === 60 ? saved.fps : fallback.fps,
    }
  } catch {
    return fallback
  }
}

export function saveQualityChoice(options: ShareOptions): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ resolution: options.resolution, fps: options.fps })) } catch { /* sem armazenamento */ }
}

/** Resolução e FPS: usados antes de começar (janela de compartilhar) e durante a transmissão (Qualidade). */
export function QualityFields({ value, onChange }: { value: ShareOptions; onChange: (next: ShareOptions) => void }) {
  return (
    <div className="quality-fields">
      <label className="field">
        <span className="field-label">Resolução</span>
        <select className="input" aria-label="Resolução" value={value.resolution} onChange={(e) => onChange({ ...value, resolution: e.target.value as ResolutionPreset })}>
          <option value="original">Original</option>
          <option value="auto">Automática</option>
          <option value="1080p">1080p</option>
          <option value="1440p">1440p</option>
          <option value="2160p">4K</option>
          <option value="720p">720p</option>
          <option value="480p">480p</option>
          <option value="360p">360p</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">FPS</span>
        <select className="input" aria-label="FPS" value={value.fps} onChange={(e) => onChange({ ...value, fps: Number(e.target.value) as FpsPreset })}>
          {[60, 30, 15].map((fps) => <option key={fps} value={fps}>{fps} FPS</option>)}
        </select>
      </label>
    </div>
  )
}
