import { useEffect, useId, useRef, useState } from 'react'
import { detectShareCapabilities, type ShareCapabilities } from '../../media/capabilities'
import { DEFAULT_QUALITY, FPS_OPTIONS, type FpsPreset, RESOLUTIONS, type ResolutionPreset } from '../../media/presets'
import type { ShareOptions } from '../../media/RoomClient'

const PREFS_KEY = 'ss:sharePrefs'

// 1440p e 4K entram na Fase 5, quando a detecção de capacidade (fonte, encoder, rede) decide se aparecem
const RESOLUTION_CHOICES: ResolutionPreset[] = ['auto', '360p', '480p', '720p', '1080p', '1440p', '2160p']

const SURFACES = [
  { value: 'monitor', label: 'Tela inteira' },
  { value: 'window', label: 'Janela' },
  { value: 'browser', label: 'Aba do navegador' },
] as const

interface Props {
  open: boolean
  onCancel: () => void
  /** Chamado direto no clique (o navegador exige gesto do usuário para abrir o seletor). */
  onShare: (options: ShareOptions) => void
  capabilities?: ShareCapabilities
}

export function ShareDialog({ open, onCancel, onShare, capabilities }: Props) {
  const caps = capabilities ?? detectShareCapabilities()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [options, setOptions] = useState<ShareOptions>(() => readPrefs(caps))
  const [customSize, setCustomSize] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  function share(event: React.FormEvent) {
    event.preventDefault()
    const effective: ShareOptions = { ...options, audio: options.audio && caps.canShareAudio, outputWidth: customSize ? options.outputWidth ?? 1920 : undefined, outputHeight: customSize ? options.outputHeight ?? 1080 : undefined }
    savePrefs(effective)
    onShare(effective)
  }

  const audioHint = audioHintFor(options)

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <form onSubmit={share} className="dialog-body">
        <h2 id={titleId}>Compartilhar tela</h2>

        {caps.canHintSurface ? (
          <fieldset className="fieldset">
            <legend className="field-label">O que compartilhar</legend>
            {SURFACES.map((s) => (
              <label key={s.value} className="radio">
                <input
                  type="radio"
                  name="surface"
                  value={s.value}
                  checked={options.surface === s.value}
                  onChange={() => setOptions({ ...options, surface: s.value })}
                />
                {s.label}
              </label>
            ))}
            <p className="muted small">A escolha final é feita na janela do navegador, que abre em seguida.</p>
          </fieldset>
        ) : (
          <p className="muted small">O navegador vai perguntar se você quer compartilhar a tela inteira ou uma janela.</p>
        )}

        <fieldset className="fieldset">
          <legend className="field-label">Áudio</legend>
          {caps.canShareAudio ? (
            <>
              <label className="checkbox">
                <input type="checkbox" checked={options.audio} onChange={(e) => setOptions({ ...options, audio: e.target.checked })} />
                Compartilhar áudio
              </label>
              {options.audio && (
                <div className="sub-options" role="radiogroup" aria-label="Qual som transmitir">
                  <label className="radio">
                    <input
                      type="radio"
                      name="audioScope"
                      checked={options.audioScope === 'shared'}
                      onChange={() => setOptions({ ...options, audioScope: 'shared' })}
                    />
                    <span>
                      Só da aba ou janela compartilhada <span className="muted">(recomendado)</span>
                      <span className="muted small block">Não inclui Discord, chamadas nem notificações.</span>
                    </span>
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="audioScope"
                      checked={options.audioScope === 'system'}
                      onChange={() => setOptions({ ...options, audioScope: 'system' })}
                    />
                    <span>
                      Todo o som do computador
                      <span className="muted small block">Inclui tudo o que toca no PC, até a call do Discord.</span>
                    </span>
                  </label>
                  <p className="muted small">{audioHint}</p>
                </div>
              )}
            </>
          ) : (
            <p className="muted small" role="note">
              ⓘ Este navegador não compartilha áudio junto com a tela. A transmissão será só de vídeo.
            </p>
          )}
        </fieldset>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Qualidade</span>
            <select
              className="input"
              value={options.resolution}
              onChange={(e) => setOptions({ ...options, resolution: e.target.value as ResolutionPreset })}
            >
              {RESOLUTION_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {r === 'original' ? 'Original' : r === 'auto' ? 'Automática' : RESOLUTIONS[r].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Taxa de quadros</span>
            <select className="input" value={options.fps} onChange={(e) => setOptions({ ...options, fps: Number(e.target.value) as FpsPreset })}>
              {FPS_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} — {f.hint}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="checkbox"><input type="checkbox" checked={customSize} onChange={(e) => setCustomSize(e.target.checked)} />Resolução personalizada</label>
        {customSize && <div className="field-row">
          <label className="field"><span>Largura (px)</span><input className="input" type="number" min="320" max="7680" step="2" required value={options.outputWidth ?? 1920} onChange={(e) => setOptions({ ...options, outputWidth: Number(e.target.value) })} /></label>
          <label className="field"><span>Altura (px)</span><input className="input" type="number" min="180" max="2160" step="2" required value={options.outputHeight ?? 1080} onChange={(e) => setOptions({ ...options, outputHeight: Number(e.target.value) })} /></label>
        </div>}
        <p className="muted small">A resolução é um limite de saída. A proporção da tela ou janela é preservada, sem esticar ou aumentar uma fonte menor. 1080p corresponde a até 1920 × 1080 em uma tela 16:9.</p>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Compartilhar
          </button>
        </div>
      </form>
    </dialog>
  )
}

function readPrefs(caps: ShareCapabilities): ShareOptions {
  const fallback: ShareOptions = {
    ...DEFAULT_QUALITY,
    surface: caps.canHintSurface ? 'monitor' : 'any',
    audio: caps.canShareAudio,
    audioScope: 'shared',
  }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ShareOptions> | null
    if (!saved) return fallback
    return {
      surface: caps.canHintSurface && saved.surface && saved.surface !== 'any' ? saved.surface : fallback.surface,
      audio: caps.canShareAudio && (saved.audio ?? fallback.audio),
      audioScope: saved.audioScope === 'system' ? 'system' : 'shared',
      resolution: saved.resolution && RESOLUTION_CHOICES.includes(saved.resolution) ? saved.resolution : fallback.resolution,
      fps: saved.fps === 15 || saved.fps === 30 || saved.fps === 60 ? saved.fps : fallback.fps,
    }
  } catch {
    return fallback
  }
}

function savePrefs(options: ShareOptions): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(options))
  } catch {
    // sem armazenamento: só não lembra a escolha
  }
}

function audioHintFor(options: ShareOptions): string {
  if (options.audioScope === 'system') {
    return 'No seletor do navegador, marque também "compartilhar o áudio do sistema". Quem assiste vai ouvir tudo, inclusive a call.'
  }
  switch (options.surface) {
    case 'monitor':
      return 'Na tela inteira o navegador só oferece o som do computador todo. Para ter áudio sem o Discord, escolha uma aba ou janela — ou a tela segue sem áudio.'
    case 'window':
      return 'Só o som do programa dessa janela, quando o navegador e o sistema permitem.'
    default:
      return 'No seletor do navegador, confirme também a opção de compartilhar o áudio da aba.'
  }
}
