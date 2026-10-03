import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShareView } from '../../media/RoomClient'
import { useRoomClient } from '../../store/roomClientContext'
import { listeningFor, useRoomSession } from '../../store/roomSession'

/** Recebe e reproduz apenas as telas escolhidas; várias telas usam grade. */
export function Stage() {
  const shares = useRoomSession((s) => s.shares)
  const watchedIds = useRoomSession((s) => s.watchedShareIds)
  const paused = useRoomSession((s) => s.watchingPaused)
  const focusShare = useRoomSession((s) => s.focusShare)
  const selected = shares.filter((s) => watchedIds.includes(s.id))
  const focused = selected[0]

  if (!focused) {
    return (
      <div className="stage-empty">
        <div className="empty-screen" aria-hidden="true">↗</div>
        <span className="eyebrow">PRONTOS PARA COMPARTILHAR</span>
        <p>{paused ? 'Você não está assistindo a nenhuma tela.' : 'Ninguém está compartilhando a tela.'}</p>
        <p className="muted small">{paused ? 'Escolha uma transmissão na lateral quando quiser assistir. Vídeo e áudio remotos estão pausados.' : 'Quando alguém compartilhar, a transmissão aparece aqui.'}</p>
      </div>
    )
  }

  const others = shares.filter((s) => !watchedIds.includes(s.id))
  return (
    <div className="stage-content">
      <div className={`watch-grid ${selected.length > 1 ? 'watch-grid-multiple' : ''}`} aria-label="Transmissões selecionadas">
        {selected.map((s) => <ShareVideo key={s.id} share={s} large keyboard={selected.length === 1} />)}
      </div>
      {others.length > 0 && (
        <div className="stage-strip" role="list" aria-label="Outros compartilhamentos">
          {others.map((s) => (
            <button key={s.id} role="listitem" className="stage-thumb" onClick={() => focusShare(s.id)} aria-label={`Ver tela de ${s.ownerName}`}>
              <span className="unwatched-card"><span className="participant-avatar">{s.ownerName.slice(0, 2).toUpperCase()}</span><span>{s.ownerName}</span><span className="small muted">Clique para assistir</span></span>
            </button>
          ))}
        </div>
      )}
      {selected
        .filter((s) => !s.isLocal && s.hasAudio)
        .map((s) => (
          <ShareAudio key={s.id} share={s} />
        ))}
    </div>
  )
}

function ShareVideo({ share, large = false, keyboard = false }: { share: ShareView; large?: boolean; keyboard?: boolean }) {
  const client = useRoomClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<HTMLElement>(null)
  const listening = useRoomSession((s) => listeningFor(s.listening, share.id))
  const hearable = !share.isLocal && share.hasAudio

  useEffect(() => {
    const element = videoRef.current
    if (!element || !share.videoReady) return
    return client.attachShareVideo(share.id, element)
  }, [client, share.id, share.videoReady])

  const label = share.isLocal ? 'Sua tela (prévia)' : `Tela de ${share.ownerName}`
  const silenced = listening.muted || listening.volume === 0
  return (
    <figure ref={frameRef} className={large ? 'share-video share-video-large' : 'share-video'} data-share-id={share.id}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label={label}
        onDoubleClick={large ? () => void toggleFullscreen(frameRef.current, videoRef.current) : undefined}
      />
      {!share.videoReady && <div className="share-loading">Carregando transmissão…</div>}
      <figcaption>
        {share.isLocal && <span className="live-dot" aria-hidden="true" />}
        {label}
        {hearable && !share.audioMuted && <span aria-hidden="true"> {silenced ? '🔇' : '🔊'}</span>}
      </figcaption>
      {large && <PlayerControls share={share} frame={frameRef} video={videoRef} keyboard={keyboard} />}
    </figure>
  )
}

/** Controles de quem assiste: volume/mudo locais e tela cheia. Não afetam os outros participantes. */
function PlayerControls({
  share,
  frame,
  video,
  keyboard,
}: {
  share: ShareView
  frame: React.RefObject<HTMLElement | null>
  video: React.RefObject<HTMLVideoElement | null>
  keyboard: boolean
}) {
  const listening = useRoomSession((s) => listeningFor(s.listening, share.id))
  const setVolume = useRoomSession((s) => s.setShareVolume)
  const toggleMute = useRoomSession((s) => s.toggleShareMute)
  const focusOnly = useRoomSession((s) => s.focusShare)
  const fullscreen = useFullscreen(frame)
  const hearable = !share.isLocal && share.hasAudio
  const silenced = listening.muted || listening.volume === 0

  const toggleFs = useCallback(() => void toggleFullscreen(frame.current, video.current), [frame, video])

  // atalhos no estilo de players de vídeo: F = tela cheia, M = mudo
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!keyboard && !(event.target instanceof Node && frame.current?.contains(event.target))) return
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        toggleFs()
      } else if (key === 'm' && hearable) {
        event.preventDefault()
        toggleMute(share.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFs, toggleMute, hearable, share.id, keyboard, frame])

  return (
    <div className="player-controls" role="toolbar" aria-label="Controles da transmissão">
      <button className="player-btn" onClick={() => focusOnly(share.id)} title="Assistir somente a esta tela" aria-label={`Ver somente ${share.ownerName}`}>▣</button>
      {hearable && (
        <>
          <button
            className="player-btn"
            onClick={() => toggleMute(share.id)}
            aria-pressed={silenced}
            aria-label={silenced ? 'Ativar som da transmissão' : 'Silenciar transmissão'}
            title={silenced ? 'Ativar som (M)' : 'Silenciar (M)'}
          >
            {silenced ? '🔇' : '🔊'}
          </button>
          <input
            className="player-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={silenced ? 0 : Math.round(listening.volume * 100)}
            onChange={(e) => setVolume(share.id, Number(e.target.value) / 100)}
            aria-label="Volume da transmissão"
            aria-valuetext={`${silenced ? 0 : Math.round(listening.volume * 100)}%`}
          />
        </>
      )}
      {share.hasAudio && share.audioMuted && !share.isLocal && <span className="player-note">áudio desativado por quem transmite</span>}
      <span className="player-spacer" />
      <button
        className="player-btn"
        onClick={toggleFs}
        aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        title={fullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
      >
        {fullscreen ? '🗗' : '⛶'}
      </button>
    </div>
  )
}

function ShareAudio({ share }: { share: ShareView }) {
  const client = useRoomClient()
  const ref = useRef<HTMLAudioElement>(null)
  const listening = useRoomSession((s) => listeningFor(s.listening, share.id))

  useEffect(() => {
    const element = ref.current
    if (!element || !share.audioReady) return
    return client.attachShareAudio(share.id, element)
  }, [client, share.id, share.audioReady])

  // aplicado depois do attach (e sempre que muda): mudo/volume são só deste navegador
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.volume = listening.volume
    element.muted = listening.muted
  }, [listening.volume, listening.muted, share.audioReady])

  return <audio ref={ref} autoPlay data-share-audio={share.id} />
}

function useFullscreen(frame: React.RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const update = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [frame])
  return active
}

async function toggleFullscreen(frame: HTMLElement | null, video: HTMLVideoElement | null): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else if (frame?.requestFullscreen) {
      await frame.requestFullscreen()
    } else {
      // Safari no iPhone: só o próprio <video> entra em tela cheia
      ;(video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.()
    }
  } catch {
    // o navegador pode recusar (ex.: sem gesto do usuário); não há o que fazer além de manter como está
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}
