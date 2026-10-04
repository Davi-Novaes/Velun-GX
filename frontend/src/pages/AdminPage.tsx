import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AccountApiError } from '../api/accounts'
import type { AdminOverview, AdminReceiving, AdminStream, AdminUser } from '../api/admin'
import { useServices } from '../app/services'
import '../styles/redesign.css'
import '../styles/admin.css'

/** Atualiza sozinho enquanto a aba está visível. */
const REFRESH_MS = 5000

type Filter = 'all' | 'online' | 'call' | 'streaming' | 'banned'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' }, { id: 'online', label: 'Online' }, { id: 'call', label: 'Em call' }, { id: 'streaming', label: 'Transmitindo' }, { id: 'banned', label: 'Banidas' },
]

function status(user: AdminUser): { rank: number; label: string; tone: string } {
  if (user.bannedAt) return { rank: 4, label: 'Banida', tone: 'banned' }
  if (user.call?.streaming) return { rank: 0, label: 'Transmitindo', tone: 'live' }
  if (user.call) return { rank: 1, label: 'Em call', tone: 'call' }
  if (user.online) return { rank: 2, label: 'Online', tone: 'online' }
  return { rank: 3, label: 'Offline', tone: 'offline' }
}

export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return 'Nunca'
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (seconds < 90) return 'Agora'
  if (seconds < 3600) return `Há ${Math.round(seconds / 60)} min`
  if (seconds < 86400) return `Há ${Math.round(seconds / 3600)} h`
  if (seconds < 86400 * 7) { const days = Math.round(seconds / 86400); return `Há ${days} ${days === 1 ? 'dia' : 'dias'}` }
  return new Date(iso).toLocaleDateString('pt-BR')
}

const LIMITATION: Record<string, string> = { cpu: 'processador no limite', bandwidth: 'internet no limite', other: 'limitado' }

/** Senha provisória legível (sem 0/O, 1/l/I), 12 caracteres aleatórios do navegador. */
export function generatePassword(length = 12): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const values = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('')
}

/** "Assistindo bifas: 57 fps · 2 travadas/min · perda 0,3%" — ruim = travando ou fps baixo */
export function describeReceiving(r: AdminReceiving): { text: string; bad: boolean } {
  const parts = [r.fps == null ? 'sem amostra' : `${Math.round(r.fps)} fps`]
  if (r.freezesPerMinute != null) parts.push(r.freezesPerMinute === 0 ? 'sem travadas' : `${r.freezesPerMinute} ${r.freezesPerMinute === 1 ? 'travada' : 'travadas'}/min`)
  if (r.lossPercent != null && r.lossPercent >= 0.5) parts.push(`perda ${r.lossPercent.toLocaleString('pt-BR')}%`)
  return { text: `Assistindo ${r.from}: ${parts.join(' · ')}`, bad: (r.freezesPerMinute ?? 0) >= 3 || (r.fps != null && r.fps < 40) }
}

/** "1920 × 1080 · 57 fps · H.264 placa de vídeo · 15 Mbps" */
export function describeStream(stream: AdminStream | null): string {
  if (!stream) return 'Transmitindo'
  const parts: string[] = []
  if (stream.width && stream.height) parts.push(`${stream.width} × ${stream.height}`)
  if (stream.fps != null) parts.push(`${Math.round(stream.fps)} fps`)
  if (stream.codec) parts.push(`${stream.codec.replace('H264', 'H.264')}${stream.hardware == null ? '' : stream.hardware ? ' placa de vídeo' : ' processador'}`)
  if (stream.mbps != null) parts.push(`${stream.mbps} Mbps`)
  return parts.join(' · ') || 'Transmitindo'
}

export function AdminPage() {
  const { admin } = useServices()
  /** checking = conferindo se já há login de painel; login = mostrar a tela de acesso */
  const [auth, setAuth] = useState<'checking' | 'login' | 'ready'>('checking')
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  /** conta com a confirmação de banimento aberta */
  const [banning, setBanning] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)
  /** conta com o formulário de trocar senha aberto */
  const [passwordFor, setPasswordFor] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [mustChange, setMustChange] = useState(true)
  const [passwordDone, setPasswordDone] = useState<{ name: string; username: string; password: string; mustChange: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const overview = await admin.overview()
      setData(overview); setError(''); setNow(Date.now()); setAuth('ready')
    } catch (e) {
      if (e instanceof AccountApiError && e.status === 401) { setAuth('login'); setData(null); return }
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o painel.')
    }
  }, [admin])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (auth !== 'ready') return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [auth, load])

  async function logout() {
    try { await admin.logout() } catch { /* o cookie expira sozinho */ }
    setData(null); setAuth('login')
  }

  async function act(run: () => Promise<void>) {
    if (acting) return
    setActing(true); setError('')
    try { await run(); setBanning(null); setReason(''); setPasswordFor(null); setNewPassword(''); await load() }
    catch (e) {
      if (e instanceof AccountApiError && e.status === 401) { setAuth('login'); return }
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally { setActing(false) }
  }

  const users = useMemo(() => {
    const text = query.trim().toLocaleLowerCase()
    return (data?.users ?? [])
      .filter((u) => filter === 'all' || (filter === 'online' && u.online) || (filter === 'call' && u.call) || (filter === 'streaming' && u.call?.streaming) || (filter === 'banned' && u.bannedAt))
      .filter((u) => !text || `${u.name} ${u.username} ${u.servers.join(' ')}`.toLocaleLowerCase().includes(text))
      .sort((a, b) => status(a).rank - status(b).rank || (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.name.localeCompare(b.name))
  }, [data, filter, query])

  if (auth === 'checking') return <main className="center-page"><p role="status" className="muted">Carregando…</p></main>
  if (auth === 'login') return <AdminLogin onDone={() => void load()} />

  const totals = data?.totals
  const counts: Record<Filter, number> = { all: totals?.users ?? 0, online: totals?.online ?? 0, call: totals?.inCall ?? 0, streaming: totals?.streaming ?? 0, banned: totals?.banned ?? 0 }
  return <main className="admin-page">
    <header className="admin-header">
      <div>
        <span className="eyebrow">VELUN GX · ADMINISTRAÇÃO</span>
        <h1>Quem está usando</h1>
        <p className="muted small" role="status">{data ? `Atualizado ${new Date(data.generatedAt).toLocaleTimeString('pt-BR')} · atualiza sozinho a cada ${REFRESH_MS / 1000} s` : 'Carregando…'}</p>
      </div>
      <div className="actions">
        <button className="btn" onClick={() => void load()}>Atualizar</button>
        <button className="btn" onClick={() => void logout()}>Sair do painel</button>
        <Link className="btn btn-primary" to="/app">Abrir o site</Link>
      </div>
    </header>

    {error && <p role="alert" className="error-text">{error}</p>}
    {data && !data.sfuAvailable && <p role="alert" className="admin-warning">O servidor de vídeo não respondeu: quem está em call pode não aparecer agora.</p>}

    {passwordDone && <section className="admin-password-done" role="status" aria-label="Senha alterada">
      <p><strong>Senha de {passwordDone.name} (@{passwordDone.username}) alterada.</strong> Envie para a pessoa:{passwordDone.mustChange ? ' ela vai criar a própria senha ao entrar.' : ''}</p>
      <div className="admin-password-input"><code>{passwordDone.password}</code><button className="btn" onClick={() => { void navigator.clipboard?.writeText(passwordDone.password).then(() => setCopied(true), () => undefined) }}>{copied ? 'Copiado' : 'Copiar'}</button><button className="btn" onClick={() => setPasswordDone(null)}>Fechar</button></div>
      <small className="muted">Esta senha não fica salva no painel: depois de fechar, não aparece mais.</small>
    </section>}
    {totals && <section className="admin-totals" aria-label="Resumo">
      <Stat label="Contas" value={totals.users} />
      <Stat label="Online agora" value={totals.online} tone="online" />
      <Stat label="Em call" value={totals.inCall} tone="call" />
      <Stat label="Transmitindo" value={totals.streaming} tone="live" />
      <Stat label="Ativos nas últimas 24 h" value={totals.activeToday} />
      <Stat label="Servidores" value={totals.servers} />
      <Stat label="Banidas" value={totals.banned} tone="banned" />
    </section>}

    <section className="admin-section" aria-labelledby="admin-people">
      <div className="admin-toolbar">
        <h2 id="admin-people">Pessoas</h2>
        <div className="admin-filters" role="group" aria-label="Filtrar pessoas">
          {FILTERS.map((f) => <button key={f.id} className={filter === f.id ? 'active' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <span>{counts[f.id]}</span></button>)}
        </div>
        <input className="input admin-search" aria-label="Buscar pessoa" placeholder="Buscar por nome, usuário ou servidor" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {data && (users.length ? <table className="admin-table">
        <thead><tr><th>Pessoa</th><th>Status</th><th>Onde está</th><th>Dispositivo</th><th>Visto por último</th><th>Conta criada</th><th>Servidores</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{users.map((u) => { const s = status(u); return <Fragment key={u.id}><tr aria-label={u.name} className={u.bannedAt ? 'admin-banned' : undefined}>
          <td data-label="Pessoa"><span className="admin-person"><span className="participant-avatar">{u.name.slice(0, 2).toUpperCase()}</span><span><strong>{u.name}</strong><small className="muted">@{u.username}</small></span></span></td>
          <td data-label="Status"><span className="admin-where"><span className={`admin-status ${s.tone}`}>{s.label}</span>{u.bannedAt && <small className="muted">{relativeTime(u.bannedAt, now)}{u.banReason ? ` · ${u.banReason}` : ''}</small>}{u.mustChangePassword && !u.bannedAt && <small className="muted">Senha provisória (ainda não trocou)</small>}</span></td>
          <td data-label="Onde está">{u.call ? <span className="admin-where"><span>{u.call.server} › #{u.call.channel}</span>{u.call.since && <small className="muted">na call {relativeTime(u.call.since, now).toLowerCase()}</small>}{u.call.streaming && <small className="admin-stream">{describeStream(u.call.stream)}{u.call.stream?.limitation && LIMITATION[u.call.stream.limitation] && <b> · {LIMITATION[u.call.stream.limitation]}</b>}</small>}{u.call.receiving.map((r) => { const d = describeReceiving(r); return <small key={r.from} className={d.bad ? 'admin-receiving bad' : 'admin-receiving'}>{d.text}</small> })}</span> : <span className="muted">—</span>}</td>
          <td data-label="Dispositivo">{u.clients.length ? u.clients.join(', ') : <span className="muted">{u.sessions ? `${u.sessions} ${u.sessions === 1 ? 'login ativo' : 'logins ativos'}` : 'Sem login ativo'}</span>}</td>
          <td data-label="Visto por último">{u.online ? 'Agora' : relativeTime(u.lastSeenAt ?? u.lastLoginAt, now)}</td>
          <td data-label="Conta criada">{new Date(u.createdAt).toLocaleDateString('pt-BR')}</td>
          <td data-label="Servidores" title={u.servers.join(', ')}>{u.servers.length ? `${u.servers.length} · ${u.servers.slice(0, 2).join(', ')}${u.servers.length > 2 ? '…' : ''}` : <span className="muted">Nenhum</span>}</td>
          <td data-label="Ações" className="admin-actions">{u.bannedAt
            ? <button className="btn" disabled={acting} onClick={() => void act(() => admin.unban(u.id))} aria-label={`Desbanir ${u.name}`}>Desbanir</button>
            : <button className="btn btn-danger" disabled={acting} onClick={() => { setBanning(banning === u.id ? null : u.id); setPasswordFor(null); setReason('') }} aria-label={`Banir ${u.name}`} aria-expanded={banning === u.id}>Banir</button>}
            <button className="btn" disabled={acting} onClick={() => { setPasswordFor(passwordFor === u.id ? null : u.id); setBanning(null); setNewPassword(''); setMustChange(true); setPasswordDone(null) }} aria-label={`Trocar senha de ${u.name}`} aria-expanded={passwordFor === u.id}>Trocar senha</button></td>
        </tr>
        {passwordFor === u.id && <tr className="admin-password-row"><td colSpan={8}>
          <form className="admin-ban-form" aria-label={`Trocar senha de ${u.name}`} onSubmit={(e) => { e.preventDefault(); const password = newPassword; void act(async () => { await admin.setPassword(u.id, password, mustChange); setPasswordDone({ name: u.name, username: u.username, password, mustChange }); setCopied(false) }) }}>
            <p><strong>Nova senha para {u.name} (@{u.username})</strong>. Os logins abertos dela (site e app) são encerrados.</p>
            <div className="admin-password-input"><input className="input" aria-label="Senha nova da conta" placeholder="Senha nova (mínimo 10 caracteres)" minLength={10} maxLength={128} required autoComplete="off" spellCheck={false} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={acting} autoFocus /><button type="button" className="btn" disabled={acting} onClick={() => setNewPassword(generatePassword())}>Gerar senha</button></div>
            <label className="admin-check"><input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} disabled={acting} /> Pedir para a pessoa criar a própria senha no próximo login (recomendado)</label>
            <div className="actions"><button className="btn btn-primary" disabled={acting}>{acting ? 'Salvando…' : 'Salvar senha'}</button><button type="button" className="btn" disabled={acting} onClick={() => setPasswordFor(null)}>Cancelar</button></div>
          </form>
        </td></tr>}
        {banning === u.id && <tr className="admin-ban-row"><td colSpan={8}>
          <form className="admin-ban-form" aria-label={`Banir ${u.name}`} onSubmit={(e) => { e.preventDefault(); void act(() => admin.ban(u.id, reason)) }}>
            <p><strong>Banir {u.name} (@{u.username})?</strong> A conta sai na hora do site, do app e da call, e não consegue mais entrar. Você pode desbanir depois.</p>
            <input className="input" aria-label="Motivo do banimento (opcional)" placeholder="Motivo (opcional, aparece para a pessoa ao tentar entrar)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} disabled={acting} autoFocus />
            <div className="actions"><button className="btn btn-danger" disabled={acting}>{acting ? 'Banindo…' : 'Confirmar banimento'}</button><button type="button" className="btn" disabled={acting} onClick={() => setBanning(null)}>Cancelar</button></div>
          </form>
        </td></tr>}
        </Fragment> })}</tbody>
      </table> : <p className="muted">Ninguém com esse filtro agora.</p>)}
    </section>

    {data && <section className="admin-section" aria-labelledby="admin-servers">
      <h2 id="admin-servers">Servidores</h2>
      {data.servers.length ? <table className="admin-table">
        <thead><tr><th>Servidor</th><th>Dono</th><th>Membros</th><th>Canais</th><th>Em call</th><th>Transmitindo</th></tr></thead>
        <tbody>{data.servers.map((s) => <tr key={s.id} aria-label={s.name}>
          <td data-label="Servidor"><strong>{s.name}</strong></td><td data-label="Dono">{s.owner}</td><td data-label="Membros">{s.members}</td>
          <td data-label="Canais">{s.channels}</td><td data-label="Em call">{s.inCall}</td><td data-label="Transmitindo">{s.streaming}</td>
        </tr>)}</tbody>
      </table> : <p className="muted">Nenhum servidor criado.</p>}
    </section>}
  </main>
}

/** Tela de acesso do painel: usuário e senha próprios do administrador, separados das contas do site. */
function AdminLogin({ onDone }: { onDone: () => void }) {
  const { admin } = useServices()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try { await admin.login(username.trim(), password); setPassword(''); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar.'); setBusy(false) }
  }
  return <main className="center-page"><form className="card account-card admin-login" onSubmit={(e) => void submit(e)} aria-labelledby="admin-login-title">
    <span className="eyebrow">VELUN GX · ADMINISTRAÇÃO</span>
    <h1 id="admin-login-title">Acesso administrativo</h1>
    <p className="muted small">Use o usuário e a senha do painel. Contas do site não entram aqui.</p>
    <label className="field-label" htmlFor="admin-username">Usuário do painel</label>
    <input id="admin-username" className="input" required autoComplete="username" maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
    <label className="field-label" htmlFor="admin-password">Senha do painel</label>
    <input id="admin-password" className="input" type="password" required autoComplete="current-password" maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
    {error && <p role="alert" className="error-text">{error}</p>}
    <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Aguarde…' : 'Entrar no painel'}</button>
  </form></main>
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className={`admin-stat ${tone ?? ''}`}><strong>{value}</strong><span>{label}</span></div>
}
