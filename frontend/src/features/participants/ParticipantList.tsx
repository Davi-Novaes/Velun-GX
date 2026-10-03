import type { ParticipantView } from '../../media/RoomClient'

function statusOf(p: ParticipantView): { label: string; tone: 'live' | 'ok' | 'warn' } {
  if (p.connection === 'reconnecting') return { label: 'reconectando', tone: 'warn' }
  if (p.isSharing) return { label: 'transmitindo', tone: 'live' }
  return { label: 'assistindo', tone: 'ok' }
}

export function ParticipantList({ participants, max }: { participants: ParticipantView[]; max: number }) {
  return (
    <section className="participants" aria-labelledby="participants-title">
      <h2 id="participants-title" className="panel-title">
        Participantes <span className="muted">({participants.length}/{max})</span>
      </h2>
      <ul className="participant-list">
        {participants.map((p) => {
          const status = statusOf(p)
          return (
            <li key={p.identity} className="participant">
              <span className="participant-avatar" aria-hidden="true">{p.name.trim().slice(0, 2).toUpperCase()}</span>
              <span className={`dot dot-${status.tone}`} aria-hidden="true" />
              <span className="participant-name">
                {p.name}
                {p.isLocal && <span className="muted"> (você)</span>}
              </span>
              {p.role === 'owner' && <span className="badge">anfitrião</span>}
              <span className={`participant-status tone-${status.tone}`}>{status.label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
