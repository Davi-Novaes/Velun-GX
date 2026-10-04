import { useState } from 'react'
import { communities, type ServerDetails, type Member, type ChannelPresence, type ServerRole } from '../../api/communities'
import { Icon } from './Icons'

export const PERMISSIONS = { channels: 1, invite: 2, move: 4, disconnect: 8, kick: 16, roles: 32, server: 64 }
export function memberRole(details: ServerDetails, member?: Member) { return details.roles?.find((r) => r.id === member?.serverRoleId) }
export function memberRank(details: ServerDetails, id: string) { return id === details.ownerUserId ? Number.MAX_SAFE_INTEGER : memberRole(details, details.members.find((m) => m.id === id))?.position ?? 0 }
export function permissionsFor(details: ServerDetails | null, id?: string) { return details && id ? id === details.ownerUserId ? 127 : memberRole(details, details.members.find((m) => m.id === id))?.permissions ?? 0 : 0 }
export function canModerate(details: ServerDetails, actor: string, target: string) { return actor !== target && memberRank(details, actor) > memberRank(details, target) }

export function MembersPanel({ details, presence, choose, close }: { details: ServerDetails; presence: ChannelPresence[]; choose: (m: Member) => void; close: () => void }) {
  const online = new Set(presence.flatMap((c) => c.participants.map((p) => p.userId)))
  const [query, setQuery] = useState('')
  const groups = [{ name: 'Proprietário', members: details.members.filter((m) => m.id === details.ownerUserId) }, ...(details.roles ?? []).map((r) => ({ name: r.name, color: r.color, members: details.members.filter((m) => m.serverRoleId === r.id && m.id !== details.ownerUserId) })), { name: 'Membros', members: details.members.filter((m) => !m.serverRoleId && m.id !== details.ownerUserId) }]
  return <aside className="server-members-panel" aria-label="Membros do servidor"><header><strong>Membros · {details.members.length}</strong><button aria-label="Fechar membros" onClick={close}><Icon name="close" /></button></header><input className="input" placeholder="Encontrar alguém" aria-label="Buscar membro" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="server-members-scroll">{groups.map((g) => {
    const members = g.members.filter((m) => m.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    return members.length ? <section key={g.name}><h3>{g.name} — {members.length}</h3>{members.map((m) => <button key={m.id} className="server-member" onClick={() => choose(m)} onContextMenu={(e) => { e.preventDefault(); choose(m) }}><span className={`member-avatar${online.has(m.id) ? ' online' : ''}`}>{m.name.slice(0, 2).toUpperCase()}</span><span><strong style={{ color: memberRole(details, m)?.color }}>{m.name}</strong><small>{presence.find((c) => c.participants.some((p) => p.userId === m.id))?.name ?? 'Fora dos canais'}</small></span>{presence.some((c) => c.participants.some((p) => p.userId === m.id && p.isSharing)) && <span className="channel-member-live">AO VIVO</span>}</button>)}</section> : null
  })}</div></aside>
}

export function MemberMenu({ details, actor, member, presence, ping, mediaPing, chooseLive, close, refresh, fail }: { details: ServerDetails; actor: string; member: Member; presence: ChannelPresence[]; ping?: number; mediaPing?: number; chooseLive: (channel: string, identity: string) => void; close: () => void; refresh: () => Promise<void>; fail: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false)
  const [confirmKick, setConfirmKick] = useState(false)
  const [error, setError] = useState('')
  const rights = permissionsFor(details, actor), allowed = canModerate(details, actor, member.id)
  const channel = presence.find((c) => c.participants.some((p) => p.userId === member.id)), participant = channel?.participants.find((p) => p.userId === member.id)
  const role = memberRole(details, member)
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh(); close() } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); fail(e) } finally { setBusy(false) } }
  return <div className="member-dialog-backdrop" onClick={close}><section className="member-dialog" role="dialog" aria-modal="true" aria-label={`Informações de ${member.name}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') close() }}><header><span className="member-profile-avatar">{member.name.slice(0,2).toUpperCase()}</span><button autoFocus aria-label="Fechar informações do membro" onClick={close}><Icon name="close" /></button></header><h2>{member.name}</h2><p className="muted">@{member.username}</p><span className="role-pill" style={{ color: role?.color }}>{member.id === details.ownerUserId ? 'Proprietário' : role?.name ?? 'Membro'}</span><dl><dt>Canal</dt><dd>{channel?.name ?? 'Fora dos canais'}</dd><dt>Ping de sinalização</dt><dd>{ping === undefined ? 'Não disponível fora do seu canal' : `${Math.round(ping)} ms`}</dd><dt>Ping de mídia (SFU)</dt><dd>{mediaPing === undefined ? 'Sem amostra de transmissão' : `${Math.round(mediaPing)} ms`}</dd></dl>{participant?.isSharing && <button className="btn btn-primary" onClick={() => { chooseLive(channel!.id, participant.identity); close() }}><Icon name="play" />Assistir transmissão</button>}
    {allowed && !!(rights & PERMISSIONS.roles) && <label className="field">Cargo<select className="input" aria-label={`Cargo de ${member.name}`} value={member.serverRoleId ?? ''} disabled={busy} onChange={(e) => void run(() => communities.assignRole(details.id, member.id, e.target.value || null))}><option value="">Membro</option>{details.roles?.filter((r) => r.position < memberRank(details, actor) && (r.permissions & ~rights) === 0).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
    {allowed && channel && !!(rights & PERMISSIONS.move) && <label className="field">Mover para canal<select className="input" aria-label={`Mover ${member.name} para canal`} disabled={busy} value="" onChange={(e) => e.target.value && void run(() => communities.move(details.id, member.id, e.target.value))}><option value="">Escolher canal…</option>{details.channels.filter((c) => c.id !== channel.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {allowed && channel && !!(rights & PERMISSIONS.disconnect) && <button className="member-action" disabled={busy} onClick={() => void run(() => communities.move(details.id, member.id, null))}>Desconectar do canal</button>}
    {allowed && !!(rights & PERMISSIONS.kick) && <button className="member-action danger" disabled={busy} onClick={() => confirmKick ? void run(() => communities.kick(details.id, member.id)) : setConfirmKick(true)}>{confirmKick ? 'Confirmar remoção do servidor' : 'Remover do servidor'}</button>}
    {error && <p role="alert" className="error-text">{error}</p>}<p className="muted small">O ping mede ida e volta ao servidor. A qualidade também depende da rede e do dispositivo.</p>
  </section></div>
}

export function RoleSettings({ details, actor, refresh, fail }: { details: ServerDetails; actor: string; refresh: () => Promise<void>; fail: (e: unknown) => void }) {
  const rights = permissionsFor(details, actor), rank = memberRank(details, actor)
  const blank = () => {
    const used = new Set(details.roles?.map((r) => r.position))
    let position = 1
    while (used.has(position) && position < Math.min(1000, rank - 1)) position++
    return { name: '', color: '#aa91ff', position, permissions: 0 } as { id?: string; name: string; color: string; position: number; permissions: number }
  }
  const [draft, setDraft] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const reset = () => { setDraft(blank()); setDeleting(false); setMessage(''); setError('') }
  const save = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const saved = await communities.saveRole(details.id, draft)
      await refresh(); setDraft(saved); setDeleting(false); setMessage('Cargo salvo. Atribua-o aos usuários na seção Membros.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar o cargo.'); fail(e) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!draft.id) return
    setBusy(true); setError('')
    try { await communities.deleteRole(details.id, draft.id); await refresh(); reset(); setMessage('Cargo excluído. Os membros voltaram ao cargo padrão.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível excluir.'); fail(e) }
    finally { setBusy(false) }
  }
  const labels: [number, string][] = [[1,'Gerenciar canais'],[2,'Criar e revogar convites'],[4,'Mover membros entre canais'],[8,'Desconectar membros'],[16,'Remover membros do servidor'],[32,'Gerenciar cargos inferiores'],[64,'Editar nome e ícone do servidor']]
  return <><h2 id="dialog-title">Cargos e permissões</h2><p className="muted">Um cargo por membro. Posições maiores ficam acima na hierarquia. Nenhum cargo supera o proprietário.</p>
    <div className="role-layout">
      <nav aria-label="Cargos"><button className="btn" disabled={busy} onClick={reset}>+ Novo cargo</button>{details.roles?.map((r: ServerRole) =>
        <button key={r.id} disabled={busy || r.position >= rank} className={draft.id === r.id ? 'selected' : ''} onClick={() => { setDraft(r); setDeleting(false); setError(''); setMessage('') }}><span style={{ background: r.color }} />{r.name}<small>{r.position}</small></button>)}</nav>
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <label className="field">Nome do cargo<input required maxLength={40} className="input" value={draft.name} disabled={busy} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <div className="role-properties"><label className="field">Cor<input type="color" value={draft.color} disabled={busy} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label><label className="field">Posição na hierarquia<input className="input" type="number" min={1} max={Math.min(1000,rank-1)} required value={draft.position} disabled={busy} onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })} /></label></div>
        <fieldset className="role-permissions" disabled={busy}><legend>Permissões</legend>{labels.map(([bit,label]) => <label key={bit}><input type="checkbox" checked={!!(draft.permissions & bit)} disabled={!(rights & bit)} onChange={(e) => setDraft({ ...draft, permissions: e.target.checked ? draft.permissions | bit : draft.permissions & ~bit })} />{label}</label>)}</fieldset>
        {error && <p className="error-text" role="alert">{error}</p>}{message && <p className="settings-success" role="status">{message}</p>}
        <div className="settings-actions"><button className="btn btn-primary" disabled={busy}>Salvar cargo</button>{draft.id && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => deleting ? void remove() : setDeleting(true)}>{deleting ? 'Confirmar exclusão' : 'Excluir cargo'}</button>}</div>
      </form>
    </div>
  </>
}
