import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AccountApiError, type AccountProfile } from '../api/accounts'
import { useServices } from '../app/services'
import '../styles/redesign.css'
import { DownloadApp } from '../features/desktop/DownloadApp'
import { NicknameForm } from '../features/workspace/NicknameForm'

export function AuthPage({ register = false }: { register?: boolean }) {
  const { accounts } = useServices()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const next = search.get('next')
  const destination = next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/app'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (register && password !== confirm) { setError('As senhas não coincidem.'); return }
    setBusy(true)
    try {
      if (register) await accounts.register(username.trim(), password, confirm)
      else await accounts.login(username.trim(), password)
      setPassword(''); setConfirm('')
      navigate(destination, { replace: true })
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar.'); setBusy(false) }
  }

  return <main className="center-page account-page">
    <section className="account-intro"><Link to="/" className="wordmark">Discord<span className="wordmark-accent">Meet</span></Link><h1>Compartilhe<br />o momento.<br />Juntos, ao vivo.</h1><p className="muted">Suas telas, seus amigos. Um lugar para se encontrar.</p><DownloadApp /></section>
    <form className="card account-card" onSubmit={(e) => void submit(e)} aria-labelledby="auth-title">
      <span className="eyebrow">{register ? 'COMECE POR AQUI' : 'BEM-VINDO DE VOLTA'}</span>
      <h2 id="auth-title">{register ? 'Criar conta' : 'Entrar na conta'}</h2>
      <p className="muted small">{register ? 'Sem e-mail, códigos ou etapas extras.' : 'Entre com seu usuário e senha.'}</p>
      <label className="field-label" htmlFor="account-username">Nome de usuário</label>
      <input id="account-username" className="input" required autoComplete="username" maxLength={32} minLength={register ? 3 : undefined} value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
      <label className="field-label" htmlFor="account-password">Senha</label>
      <input id="account-password" className="input" type="password" required autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 10 : undefined} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
      {register && <><label className="field-label" htmlFor="account-confirm">Confirmar senha</label><input id="account-confirm" className="input" type="password" required autoComplete="new-password" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} /><p className="muted small account-warning">Use ao menos 10 caracteres e guarde sua senha: ainda não existe recuperação de conta.</p></>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}</button>
      <p className="muted small account-switch">{register ? 'Já possui conta?' : 'Não possui conta?'} <Link to={`${register ? '/login' : '/register'}${next ? `?next=${encodeURIComponent(destination)}` : ''}`}>{register ? 'Entrar' : 'Criar conta'}</Link></p>
    </form>
  </main>
}

export function AccountPage() {
  const { accounts } = useServices()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    void accounts.me().then((p) => { if (active) setProfile(p) }, (e: unknown) => {
      if (!active) return
      if (e instanceof AccountApiError && e.status === 401) navigate('/login', { replace: true })
      else setError(e instanceof Error ? e.message : 'Não foi possível carregar sua conta.')
    })
    return () => { active = false }
  }, [accounts, navigate, attempt])

  async function logout() {
    setBusy(true); setError('')
    try { await accounts.logout(); setProfile(null); navigate('/login', { replace: true }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível sair.'); setBusy(false) }
  }
  return <main className="center-page"><section className="card account-card">
    <span className="eyebrow">TELAJUNTO</span><h1>Sua conta</h1>
    {profile ? <><div className="account-identity"><span className="participant-avatar">{profile.name.slice(0, 2).toUpperCase()}</span><span>{profile.name}<small className="muted">Conta conectada</small></span></div><p className="muted small">Seus servidores e canais estão vinculados à sua conta.</p><NicknameForm profile={profile} onSaved={setProfile} /><DownloadApp /><div className="actions"><Link className="btn btn-primary" to="/app">Abrir servidores</Link><Link className="btn" to="/legacy">Abrir salas de transmissão</Link><button className="btn" onClick={() => void logout()} disabled={busy}>Sair da conta</button></div></> : !error && <p role="status">Carregando conta…</p>}
    {error && <><p role="alert" className="error-text">{error}</p>{!profile && <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button>}</>}
  </section></main>
}
