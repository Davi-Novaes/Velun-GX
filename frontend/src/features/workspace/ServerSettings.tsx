import { useEffect, useRef, useState } from 'react'
import { communities, type ServerDetails, type ChannelPresence } from '../../api/communities'
import { canModerate, memberRank, memberRole, PERMISSIONS, permissionsFor, RoleSettings } from './CommunityControls'
import { Icon } from './Icons'
import { IconPicker } from './IconPicker'

export type SettingsTab = 'general' | 'roles' | 'members' | 'channels' | 'invites'
export function ServerSettings({ details, actor, presence, tab, selectTab, close, refresh, removed, editChannel, invite }: {
  details: ServerDetails; actor: string; presence: ChannelPresence[]; tab: SettingsTab; selectTab: (tab: SettingsTab) => void;
  close: () => void; refresh: () => Promise<void>; removed: () => Promise<void>; editChannel: (id?: string) => void; invite: () => void;
}) {
  const rights = permissionsFor(details, actor), owner = details.ownerUserId === actor
  const [name, setName] = useState(details.name), [icon, setIcon] = useState(details.icon)
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement; closeRef.current?.focus(); return () => previous?.focus() }, [])
  const run = async (action: () => Promise<unknown>, success: string, reload = true) => {
    setBusy(true); setError(''); setMessage('')
    try { await action(); if (reload) await refresh(); setMessage(success); setConfirm('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar. Tente novamente.') }
    finally { setBusy(false) }
  }
  const tabs: [SettingsTab, string][] = [['general', 'Visão geral'], ['roles', 'Cargos e permissões'], ['members', 'Membros'], ['channels', 'Canais'], ['invites', 'Convites']]
  const visible = tabs.filter(([t]) => t !== 'roles' || !!(rights & PERMISSIONS.roles))
  const actualTab = visible.some(([t]) => t === tab) ? tab : 'general'
  return <section className="server-settings-page" role="dialog" aria-modal="true" aria-label="Configurações do servidor" onKeyDown={(e) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); close() }
    if (e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')]
      const first = items[0], last = items.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
  }}>
    <aside className="settings-navigation"><span className="eyebrow">CONFIGURAÇÕES DO SERVIDOR</span><h1>{details.name}</h1><nav aria-label="Seções do servidor">{visible.map(([id, label]) => <button key={id} disabled={busy} aria-current={actualTab === id ? 'page' : undefined} onClick={() => { selectTab(id); setMessage(''); setError(''); setConfirm('') }}>{label}{id === 'members' && <small>{details.members.length}</small>}</button>)}</nav><p>Organize sua comunidade.<br />A transmissão continua conectada.</p></aside>
    <div className="settings-body"><header className="settings-topbar"><span>{details.name} / {tabs.find(([id]) => id === actualTab)?.[1]}</span><button ref={closeRef} className="btn" aria-label="Fechar configurações do servidor" disabled={busy} onClick={close}><Icon name="close" />Voltar ao canal</button></header>
      <div className="settings-content" key={actualTab}>
        {actualTab === 'general' && <><h2>Visão geral</h2><p className="muted">A identidade e os detalhes do seu servidor.</p><form onSubmit={(e) => { e.preventDefault(); void run(async () => { await communities.rename(details.id, name.trim()); await communities.setIcon(details.id, icon) }, 'Servidor atualizado.') }}><label className="field">Nome do servidor<input className="input" value={name} required maxLength={80} disabled={busy || !(rights & PERMISSIONS.server)} onChange={(e) => setName(e.target.value)} /></label>{!!(rights & PERMISSIONS.server) && <><IconPicker value={icon} onChange={setIcon} /><button className="btn btn-primary" disabled={busy}>Salvar servidor</button></>}</form><section className="settings-danger"><h3>{owner ? 'Excluir servidor' : 'Sair do servidor'}</h3><p className="muted">{owner ? 'Esta ação remove todos os canais e convites. Não pode ser desfeita.' : 'Você precisará de um convite para voltar.'}</p><button className="btn btn-danger" disabled={busy} onClick={() => confirm === 'server' ? void run(async () => { if (owner) await communities.remove(details.id); else await communities.leave(details.id); await removed() }, '', false) : setConfirm('server')}>{confirm === 'server' ? owner ? 'Confirmar exclusão do servidor' : 'Confirmar saída' : owner ? 'Excluir servidor' : 'Sair do servidor'}</button></section></>}
        {actualTab === 'roles' && <RoleSettings details={details} actor={actor} refresh={refresh} fail={() => undefined} />}
        {actualTab === 'members' && <><h2>Membros <span className="muted">· {details.members.length}</span></h2><p className="muted">Atribua cargos e gerencie quem faz parte da comunidade. Você só pode gerenciar membros abaixo do seu cargo.</p><input className="input settings-search" aria-label="Buscar membro nas configurações" placeholder="Buscar por nome ou usuário" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="settings-members">{details.members.filter((m) => `${m.name} ${m.username}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((m) => {
          const role = memberRole(details, m), allowed = canModerate(details, actor, m.id), channel = presence.find((c) => c.participants.some((p) => p.userId === m.id))
          return <div className="settings-member-row" key={m.id}><span className="member-avatar">{m.name.slice(0,2).toUpperCase()}</span><div className="settings-member-name"><strong style={{ color: role?.color }}>{m.name}</strong><small>@{m.username} · {channel?.name ?? 'Fora dos canais'}</small></div>{allowed && !!(rights & PERMISSIONS.roles) ? <select className="input" aria-label={`Cargo de ${m.name}`} value={m.serverRoleId ?? ''} disabled={busy} onChange={(e) => void run(() => communities.assignRole(details.id, m.id, e.target.value || null), `Cargo de ${m.name} atualizado.`)}><option value="">Membro</option>{details.roles?.filter((r) => r.position < memberRank(details, actor) && (r.permissions & ~rights) === 0).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select> : <span className="role-pill" style={{ color: role?.color }}>{m.id === details.ownerUserId ? 'Proprietário' : role?.name ?? 'Membro'}</span>}{allowed && !!(rights & PERMISSIONS.kick) && <button className="btn btn-danger" disabled={busy} onClick={() => confirm === m.id ? void run(() => communities.kick(details.id, m.id), 'Membro removido.') : setConfirm(m.id)}>{confirm === m.id ? 'Confirmar remoção' : 'Remover'}</button>}</div>
        })}</div></>}
        {actualTab === 'channels' && <><h2>Canais</h2><p className="muted">Cada canal mantém seus participantes e transmissões separados.</p>{!!(rights & PERMISSIONS.channels) && <button className="btn btn-primary" onClick={() => editChannel()}>Criar canal</button>}<div className="settings-members">{details.channels.map((c) => <div className="settings-member-row" key={c.id}><Icon name="monitor" /><strong>#{c.name}</strong><span className="muted">{presence.find((p) => p.id === c.id)?.participants.length ?? 0} conectados</span>{!!(rights & PERMISSIONS.channels) && <button className="btn" onClick={() => editChannel(c.id)}>Configurar canal {c.name}</button>}</div>)}</div></>}
        {actualTab === 'invites' && <><h2>Convites</h2><p className="muted">Compartilhe um convite para trazer seus amigos. Você pode limitar os usos e revogar os links na gestão de convites.</p><button className="btn btn-primary" disabled={!(rights & PERMISSIONS.invite)} onClick={invite}>Gerenciar convites</button></>}
        {error && <p className="error-text" role="alert">{error}</p>}{message && <p className="settings-success" role="status">{message}</p>}
      </div>
    </div>
  </section>
}
