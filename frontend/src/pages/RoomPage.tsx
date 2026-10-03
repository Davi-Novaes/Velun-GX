import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, describeError } from '../api/client'
import type { RoomInfo } from '../api/contracts'
import { useServices } from '../app/services'
import { CopyButton } from '../components/CopyButton'
import { ParticipantList } from '../features/participants/ParticipantList'
import { ShareDialog } from '../features/share/ShareDialog'
import { SharingPanel } from '../features/share/SharingPanel'
import { Stage } from '../features/stage/Stage'
import { detectShareCapabilities } from '../media/capabilities'
import { RoomClientContext } from '../store/roomClientContext'
import { createRoomSession, RoomSessionContext, useRoomSession } from '../store/roomSession'
import { roomLink } from './HomePage'

const NAME_KEY = 'ss:displayName'
const MAX_NAME = 32

type Lookup = { kind: 'loading' } | { kind: 'ready'; info: RoomInfo } | { kind: 'missing'; message: string } | { kind: 'error'; message: string }

export function RoomPage() {
  const { code = '' } = useParams()
  const { api, createRoomClient } = useServices()
  const [client] = useState(() => createRoomClient())
  const [store] = useState(() => createRoomSession(code, client, api))

  useEffect(() => store.getState().start(), [store])

  return (
    <RoomClientContext.Provider value={client}>
      <RoomSessionContext.Provider value={store}>
        <RoomFlow />
      </RoomSessionContext.Provider>
    </RoomClientContext.Provider>
  )
}

function RoomFlow() {
  const phase = useRoomSession((s) => s.phase)
  switch (phase) {
    case 'prejoin':
      return <PreJoin />
    case 'joining':
    case 'connecting':
    case 'verifying':
      return <Connecting />
    case 'connected':
    case 'reconnecting':
      return <InRoom />
    case 'failed':
    case 'disconnected':
      return <Ended />
  }
}

function PreJoin() {
  const { api } = useServices()
  const code = useRoomSession((s) => s.code)
  const join = useRoomSession((s) => s.join)
  const [lookup, setLookup] = useState<Lookup>({ kind: 'loading' })
  const [name, setName] = useState(() => readName())
  const [touched, setTouched] = useState(false)

  const load = useCallback(async () => {
    setLookup({ kind: 'loading' })
    try {
      setLookup({ kind: 'ready', info: await api.getRoom(code) })
    } catch (error) {
      const missing = error instanceof ApiError && (error.code === 'ROOM_NOT_FOUND' || error.code === 'ROOM_EXPIRED')
      setLookup({ kind: missing ? 'missing' : 'error', message: describeError(error) })
    }
  }, [api, code])

  useEffect(() => {
    void load()
  }, [load])

  const trimmed = name.trim()
  const nameError = trimmed.length === 0 ? 'Informe seu nome.' : [...trimmed].length > MAX_NAME ? `Use até ${MAX_NAME} caracteres.` : null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (nameError || lookup.kind !== 'ready' || lookup.info.isFull) return
    saveName(trimmed)
    void join(trimmed)
  }

  if (lookup.kind === 'missing') {
    return (
      <main className="center-page">
        <section className="card" role="alert">
          <h1>Sala indisponível</h1>
          <p className="muted">{lookup.message}</p>
          <Link className="btn btn-primary" to="/">
            Criar nova sala
          </Link>
        </section>
      </main>
    )
  }

  const info = lookup.kind === 'ready' ? lookup.info : null
  return (
    <main className="center-page">
      <form className="card" onSubmit={submit} noValidate aria-labelledby="prejoin-title">
        <h1 id="prejoin-title">Entrar na sala</h1>
        <p className="muted mono">{code.toUpperCase()}</p>

        <label className="field-label" htmlFor="display-name">
          Nome
        </label>
        <input
          id="display-name"
          className="input"
          autoFocus
          autoComplete="nickname"
          maxLength={MAX_NAME * 2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={touched && nameError !== null}
          aria-describedby="name-help"
        />
        <p id="name-help" className={touched && nameError ? 'error-text' : 'muted small'}>
          {touched && nameError ? nameError : 'Como os outros participantes vão ver você.'}
        </p>

        {lookup.kind === 'loading' && <p className="muted small">Verificando sala…</p>}
        {lookup.kind === 'error' && (
          <p role="alert" className="error-text">
            {lookup.message}{' '}
            <button type="button" className="link-btn" onClick={() => void load()}>
              Tentar novamente
            </button>
          </p>
        )}
        {info && !info.isFull && (
          <p className="muted small">
            {info.participantCount}/{info.maxParticipants} participantes na sala
          </p>
        )}
        {info?.isFull && (
          <p role="alert" className="error-text">
            Sala cheia ({info.participantCount}/{info.maxParticipants}). O limite de participantes foi atingido.{' '}
            <button type="button" className="link-btn" onClick={() => void load()}>
              Verificar de novo
            </button>
          </p>
        )}

        <button className="btn btn-primary btn-lg" type="submit" disabled={!info || info.isFull}>
          Entrar
        </button>
      </form>
    </main>
  )
}

function Connecting() {
  const phase = useRoomSession((s) => s.phase)
  const steps = [
    { key: 'connect', label: 'Conectando…', done: phase === 'verifying' },
    { key: 'verify', label: 'Verificando conexão…', done: false, pending: phase !== 'verifying' },
  ]
  return (
    <main className="center-page">
      <section className="card" aria-live="polite" aria-busy="true">
        <div className="spinner" aria-hidden="true" />
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.key} className={s.done ? 'step done' : s.pending ? 'step pending' : 'step active'}>
              {s.label}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

function InRoom() {
  const code = useRoomSession((s) => s.code)
  const phase = useRoomSession((s) => s.phase)
  const participants = useRoomSession((s) => s.participants)
  const max = useRoomSession((s) => s.policy?.maxParticipants ?? 20)
  const leave = useRoomSession((s) => s.leave)
  const shares = useRoomSession((s) => s.shares)
  const localShare = useRoomSession((s) => s.localShare)
  const audioBlocked = useRoomSession((s) => s.audioBlocked)
  const startAudio = useRoomSession((s) => s.startAudio)
  const stopShare = useRoomSession((s) => s.stopShare)
  const setShareAudio = useRoomSession((s) => s.setShareAudio)
  const watchedIds = useRoomSession((s) => s.watchedShareIds)
  const toggleWatchShare = useRoomSession((s) => s.toggleWatchShare)
  const watchAllShares = useRoomSession((s) => s.watchAllShares)
  const paused = useRoomSession((s) => s.watchingPaused)
  const focusShare = useRoomSession((s) => s.focusShare)
  const stopWatching = useRoomSession((s) => s.stopWatching)
  const [justConnected, setJustConnected] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setJustConnected(false), 1800)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="room-layout">
      <nav className="server-rail" aria-label="Navegação"><a href="/" title="Página inicial" className="rail-home">TJ</a><span className="rail-divider" /><span className="rail-room" title="Sala atual">▣</span></nav>
      <header className="room-header">
        <span className="brand-mark small" aria-hidden="true" />
        <h1 className="room-title">
          Sala <span className="mono">{code.toUpperCase()}</span>
        </h1>
        <span className={`connection-pill ${phase === 'reconnecting' ? 'connection-warn' : ''}`}><span className={`dot dot-${phase === 'reconnecting' ? 'warn' : 'ok'}`} />{phase === 'reconnecting' ? 'Reconectando' : 'Conectado'}</span>
        <CopyButton text={roomLink(code.toUpperCase())} label="Copiar link" className="btn btn-ghost" />
      </header>

      {phase === 'reconnecting' && (
        <div className="banner banner-warn" role="status">
          Reconectando…
        </div>
      )}
      {phase === 'connected' && justConnected && (
        <div className="toast" role="status">
          Conectado!
        </div>
      )}

      {audioBlocked && shares.some((s) => watchedIds.includes(s.id) && !s.isLocal && s.hasAudio) && (
        <button className="banner banner-info" onClick={() => void startAudio()}>
          🔇 Clique para ouvir o áudio da transmissão
        </button>
      )}
      <Notice />

      <main className="stage" aria-label="Tela compartilhada">
        <Stage />
      </main>

      <aside className="sidebar">
        <div className="channel-label">SALA DE TRANSMISSÃO</div>
        <div className="channel-active">▣ <span>Compartilhamento de tela</span></div>
        <section className="watch-picker" aria-label="Escolher transmissão">
          <h2 className="panel-title">Transmissões <span className="muted">({shares.length})</span></h2>
          <button className={`watch-choice ${paused ? 'selected' : ''}`} onClick={stopWatching} aria-pressed={paused}><span>◌</span><span>Não assistir a nenhuma<small>Economizar rede e processamento</small></span></button>
          {shares.length > 1 && <button className="watch-choice" onClick={watchAllShares}><span>▦</span><span>Assistir a todas<small>Visualizar em grade</small></span></button>}
          {shares.length > 0 && <p className="small muted watch-help">Clique no nome para ver só uma. Use + para combinar telas.</p>}
          {shares.map((share) => {
            const selected = watchedIds.includes(share.id)
            return <div className="watch-row" key={share.id}>
              <button className={`watch-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => focusShare(share.id)}><span className="participant-avatar">{share.ownerName.slice(0, 2).toUpperCase()}</span><span>{share.ownerName}{share.isLocal ? ' (sua tela)' : ''}<small>{selected ? 'Assistindo' : 'Clique para assistir'}</small></span><span className="live-tag">AO VIVO</span></button>
              <button className={`watch-toggle ${selected ? 'selected' : ''}`} aria-label={`${selected ? 'Remover' : 'Adicionar'} tela de ${share.ownerName} ${selected ? 'da' : 'à'} grade`} aria-pressed={selected} onClick={() => toggleWatchShare(share.id)} title={selected ? 'Remover da grade' : 'Adicionar à grade'}>{selected ? '✓' : '+'}</button>
            </div>
          })}
        </section>
        {localShare && (
          <SharingPanel share={localShare} onToggleAudio={() => void setShareAudio(!localShare.audioEnabled)} onStop={() => void stopShare()} />
        )}
        <ParticipantList participants={participants} max={max} />
      </aside>

      <footer className="controls" aria-label="Controles">
        <ShareButton />
        <button className="btn btn-danger" onClick={() => void leave()}>
          Sair
        </button>
      </footer>
    </div>
  )
}

function ShareButton() {
  const [caps] = useState(() => detectShareCapabilities())
  const [dialogOpen, setDialogOpen] = useState(false)
  const localShare = useRoomSession((s) => s.localShare)
  const shareCount = useRoomSession((s) => s.shares.length)
  const maxShares = useRoomSession((s) => s.policy?.maxConcurrentScreenShares ?? 3)
  const startShare = useRoomSession((s) => s.startShare)
  const stopShare = useRoomSession((s) => s.stopShare)

  if (!caps.canShare) {
    return (
      <p className="muted small controls-note">
        Este dispositivo não permite compartilhar a tela. Você pode assistir normalmente.
      </p>
    )
  }

  if (localShare) {
    return (
      <button className="btn btn-danger" onClick={() => void stopShare()}>
        Parar compartilhamento
      </button>
    )
  }

  const limitReached = shareCount >= maxShares
  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => setDialogOpen(true)}
        disabled={limitReached}
        title={limitReached ? `Limite de ${maxShares} compartilhamentos simultâneos atingido` : undefined}
      >
        Compartilhar tela
      </button>
      <ShareDialog
        open={dialogOpen}
        capabilities={caps}
        onCancel={() => setDialogOpen(false)}
        onShare={(options) => {
          setDialogOpen(false)
          void startShare(options)
        }}
      />
    </>
  )
}

function Notice() {
  const notice = useRoomSession((s) => s.notice)
  const dismiss = useRoomSession((s) => s.dismissNotice)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(dismiss, 6000)
    return () => clearTimeout(timer)
  }, [notice, dismiss])

  if (!notice) return null
  return (
    <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      <button className="link-btn" onClick={dismiss} aria-label="Fechar aviso">
        ✕
      </button>
    </div>
  )
}

function Ended() {
  const phase = useRoomSession((s) => s.phase)
  const cause = useRoomSession((s) => s.cause)
  const error = useRoomSession((s) => s.error)
  const join = useRoomSession((s) => s.join)

  const title =
    phase === 'failed'
      ? error?.kind === 'room_full'
        ? 'Sala cheia'
        : 'Não foi possível entrar'
      : cause === 'left'
        ? 'Você saiu da sala'
        : cause === 'replaced'
          ? 'Você entrou em outra aba'
          : cause === 'room_closed'
            ? 'A sala foi encerrada'
            : cause === 'removed'
              ? 'Você foi removido da sala'
              : 'Conexão perdida'

  const detail =
    phase === 'failed'
      ? error?.message
      : cause === 'replaced'
        ? 'Esta sala foi aberta com o seu nome em outra aba ou dispositivo.'
        : cause === 'lost'
          ? 'Não foi possível manter a conexão com o servidor.'
          : null

  const canRejoin = !(phase === 'failed' && (error?.kind === 'room_not_found' || error?.kind === 'room_expired'))

  return (
    <main className="center-page">
      <section className="card" role={phase === 'failed' ? 'alert' : 'status'}>
        <h1>{title}</h1>
        {detail && <p className="muted">{detail}</p>}
        <div className="actions">
          {canRejoin && (
            <button className="btn btn-primary" onClick={() => void join(readName())}>
              {phase === 'failed' ? 'Tentar novamente' : 'Entrar novamente'}
            </button>
          )}
          <Link className="btn" to="/">
            Início
          </Link>
        </div>
      </section>
    </main>
  )
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // sem armazenamento: só não lembra o nome
  }
}
