import type { LocalShare } from '../../media/RoomClient'

const SURFACE_LABEL: Record<LocalShare['surface'], string> = {
  monitor: 'Tela inteira',
  window: 'Janela',
  browser: 'Aba do navegador',
  unknown: 'Tela',
}

/** Estado da própria transmissão: deixa claro que você está transmitindo e o que está indo. */
export function SharingPanel({ share, onToggleAudio, onStop }: { share: LocalShare; onToggleAudio: () => void; onStop: () => void }) {
  const audioLabel = !share.hasAudio ? (share.audioRequested ? 'Indisponível' : 'Desligado') : share.audioEnabled ? 'Ativado' : 'Desativado'
  const audioSource = share.hasAudio ? (share.audioScope === 'system' ? 'som do computador todo' : 'só do que é compartilhado') : null

  return (
    <section className="sharing-panel" aria-label="Sua transmissão">
      <p className="live-label">
        <span className="live-dot" aria-hidden="true" />
        Transmitindo
      </p>
      <dl className="share-facts">
        <div>
          <dt>{SURFACE_LABEL[share.surface]}</dt>
          <dd>
            🎥 {share.width}x{share.height}
          </dd>
        </div>
        <div>
          <dt>Taxa</dt>
          <dd>⚡ {share.fps} FPS</dd>
        </div>
        <div>
          <dt>Áudio</dt>
          <dd>
            {share.hasAudio && share.audioEnabled ? '🔊' : '🔇'} {audioLabel}
            {audioSource && <span className="muted small block">{audioSource}</span>}
          </dd>
        </div>
      </dl>
      <div className="sharing-actions">
        {share.hasAudio && (
          <button className="btn" onClick={onToggleAudio} aria-pressed={!share.audioEnabled}>
            {share.audioEnabled ? 'Desativar áudio' : 'Ativar áudio'}
          </button>
        )}
        <button className="btn btn-danger" onClick={onStop}>
          Parar compartilhamento
        </button>
      </div>
    </section>
  )
}
