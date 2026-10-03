import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AccountApiError } from '../api/accounts'
import { communities, type InviteInfo } from '../api/communities'

export function InvitePage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; void communities.preview(code).then((i) => { if (active) setInvite(i) }, (e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Convite inválido.') }); return () => { active = false } }, [code])
  async function accept() {
    setBusy(true); setError('')
    try { const result = await communities.accept(code); navigate(`/app/${result.serverId}`, { replace: true }) }
    catch (e) { if (e instanceof AccountApiError && e.status === 401) navigate(`/login?next=${encodeURIComponent(`/invite/${code}`)}`); else setError(e instanceof Error ? e.message : 'Não foi possível entrar.'); setBusy(false) }
  }
  return <main className="center-page"><section className="card account-card"><Link className="wordmark" to="/app">Tela<span className="wordmark-accent">junto</span></Link>{invite ? <><p className="muted">{invite.invitedBy} convidou você para</p><h1>{invite.name}</h1><p className="muted">{invite.memberCount} {invite.memberCount === 1 ? 'membro' : 'membros'} · telas ao vivo com sua turma</p><button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void accept()}>{busy ? 'Entrando…' : 'Entrar no servidor'}</button></> : !error && <p>Carregando convite…</p>}{error && <p role="alert" className="error-text">{error}</p>}</section></main>
}
