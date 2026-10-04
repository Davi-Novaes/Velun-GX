import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LiveKitRoomClient } from '../../media/LiveKitRoomClient'
import type { LocalShare, ShareView, ShareViewer } from '../../media/RoomClient'
import { describeQuality } from '../../media/presets'
import { NETWORK_LABEL, networkLevel } from './network'
import { APP_BUILD } from '../../build'
import { Icon } from './Icons'
import { useStreamContext } from './StreamContext'
import { computeStageLayout, type TileRole, type ViewMode } from './stageLayout'
import { describeEncoder } from '../../media/codecChoice'

/** Quantas pessoas estão recebendo a transmissão; clicar mostra os nomes. */
export function ViewersBadge({ viewers, isLocal }: { viewers: ShareViewer[]; isLocal: boolean }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 })
  useEffect(() => { if (!open) return; const close = (e: PointerEvent) => { const target = e.target as Element; if (!target.closest('.viewers-popover') && !button.current?.contains(target)) setOpen(false) }; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }; document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) } }, [open])
  const others = viewers.filter((v) => !v.isLocal)
  const names = viewers.map((v) => v.name).join(', ')
  return <span className="stream-viewers" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}>
    <button ref={button} aria-expanded={open} aria-label={`${viewers.length} ${viewers.length === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}`} title={viewers.length ? `Assistindo: ${names}` : 'Ninguém assistindo agora'} onClick={() => { const rect = button.current!.getBoundingClientRect(); setAnchor({ left: Math.max(8, Math.min(rect.left, innerWidth - 270)), ...(innerHeight - rect.bottom >= 250 || rect.top < 250 ? { top: rect.bottom + 8 } : { bottom: innerHeight - rect.top + 8 }) }); setOpen(!open) }}>
      <Icon name="eye" size={14} />{viewers.length}
    </button>
    {open && createPortal(<div className="viewers-popover" style={{ position: 'fixed', left: anchor.left, top: anchor.top ?? 'auto', bottom: anchor.bottom ?? 'auto', maxHeight: 'min(240px, calc(100dvh - 16px))', overflowY: 'auto' }} role="dialog" aria-label="Quem está assistindo">
      <header><strong>{isLocal ? 'Assistindo você' : 'Assistindo'}</strong><button aria-label="Fechar espectadores" onClick={() => setOpen(false)}><Icon name="close" size={14} /></button></header>
      {viewers.length ? <ul>{viewers.map((v) => <li key={v.identity}><span className="stream-avatar">{v.name.slice(0, 2).toUpperCase()}</span>{v.name}</li>)}</ul>
        : <p>{isLocal ? 'Ninguém está assistindo sua transmissão agora.' : 'Ninguém assistindo agora.'}</p>}
      {isLocal && others.length > 0 && <small>Conta só quem está recebendo o vídeo agora.</small>}
    </div>, document.fullscreenElement ?? document.body)}
  </span>
}

export interface OwnerActions { quality: () => void; source: () => void; stop: () => void; audio?: () => void; state: LocalShare | null }

/** Cliques nos controles não acionam o tile (destacar/tela cheia) que está por baixo. */
const keepInside = { onClick: (e: { stopPropagation(): void }) => e.stopPropagation(), onDoubleClick: (e: { stopPropagation(): void }) => e.stopPropagation() }

/**
 * Uma transmissão: o próprio vídeo, com nome e AO VIVO sempre visíveis e controles sobrepostos que aparecem
 * ao passar o mouse. variant muda só a apresentação (grade, principal do destaque ou miniatura da fileira).
 */
export function StreamTile({ share, client, focus, hide, variant = 'grid', style, ownerActions, onAspect }: {
  share: ShareView
  client: LiveKitRoomClient
  /** Coloca esta transmissão em destaque. */
  focus: () => void
  hide?: () => void
  variant?: TileRole
  style?: CSSProperties
  ownerActions?: OwnerActions
  /** Informa a proporção real do vídeo (o destaque usa para não deixar faixas). */
  onAspect?: (aspect: number) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const container = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const [menuAnchor, setMenuAnchor] = useState({ left: 0, top: 0 })
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => { if (!menuButton.current?.contains(e.target as Node) && !(e.target as Element).closest('.stream-floating-menu')) setMenu(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); menuButton.current?.focus() } }
    const reposition = () => setMenu(false)
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); window.addEventListener('resize', reposition)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); window.removeEventListener('resize', reposition) }
  }, [menu])
  const [full, setFull] = useState(false)
  // Em tela cheia as barras ficam escondidas e só aparecem quando o mouse se move (somem de novo após 2,5 s parado).
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const overChrome = useRef(false)
  // toque (celular): não existe "passar o mouse"; um toque mostra os controles por alguns segundos
  const [touchControls, setTouchControls] = useState(false)
  const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [info, setInfo] = useState(false)
  // janela flutuante do sistema (picture-in-picture): fica por cima de outros programas, inclusive do jogo
  const [floating, setFloating] = useState(false)
  const canFloat = typeof document !== 'undefined' && document.pictureInPictureEnabled === true
  useEffect(() => {
    const el = video.current
    if (!el) return
    const enter = () => setFloating(true), leave = () => setFloating(false)
    el.addEventListener('enterpictureinpicture', enter); el.addEventListener('leavepictureinpicture', leave)
    return () => { el.removeEventListener('enterpictureinpicture', enter); el.removeEventListener('leavepictureinpicture', leave) }
  }, [])
  async function toggleFloating() {
    setMenu(false)
    try {
      if (document.pictureInPictureElement === video.current) await document.exitPictureInPicture()
      else await video.current?.requestPictureInPicture()
    } catch { setError('A janela flutuante não está disponível para este vídeo neste navegador.') }
  }
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [error, setError] = useState('')
  const { samples, audio, changeAudio } = useStreamContext()
  const sample = samples.find((s) => s.identity === share.id)
  const preference = audio[share.id] ?? { muted: false, volume: 0.8 }
  const muted = preference.muted || preference.volume === 0
  const selected = share.isLocal ? ownerActions?.state?.quality ?? share.report?.quality : share.report?.quality
  const ping = share.isLocal ? sample?.rttMs : share.report?.rttMs
  const level = networkLevel(ping, share.isLocal ? sample?.lossPercent : share.report?.lossPercent)
  // o mesmo <video> continua montado ao trocar grade/destaque: só o attach inicial e trocas reais de track religam
  useEffect(() => { if (video.current) return client.attachShareVideo(share.id, video.current) }, [client, share.id, share.videoReady, share.trackVersion])
  const reportAspect = useRef(onAspect)
  reportAspect.current = onAspect
  useEffect(() => {
    const el = video.current
    if (!el) return
    const update = () => {
      setDimensions({ width: el.videoWidth, height: el.videoHeight })
      if (el.videoWidth && el.videoHeight) reportAspect.current?.(el.videoWidth / el.videoHeight)
    }
    update(); el.addEventListener('resize', update); el.addEventListener('loadedmetadata', update)
    return () => { el.removeEventListener('resize', update); el.removeEventListener('loadedmetadata', update) }
  }, [share.trackVersion])
  // tamanho exibido define a camada de simulcast pedida ao SFU (miniatura = camada baixa; principal = alta)
  useEffect(() => {
    if (!video.current || share.isLocal) return
    const observer = new ResizeObserver(([entry]) => { if (entry) client.setViewingSize(share.id, entry.contentRect.width, entry.contentRect.height) })
    observer.observe(video.current); return () => observer.disconnect()
  }, [client, share.id, share.isLocal, share.videoReady])
  useEffect(() => {
    const change = () => {
      const isFull = document.fullscreenElement === container.current
      setFull(isFull)
      clearTimeout(hideTimer.current)
      // ao entrar em tela cheia, começa só com o vídeo
      setChromeVisible(!isFull)
    }
    document.addEventListener('fullscreenchange', change)
    return () => { document.removeEventListener('fullscreenchange', change); clearTimeout(hideTimer.current); clearTimeout(touchTimer.current) }
  }, [])
  const keepChrome = menu || info
  useEffect(() => { if (keepChrome) { clearTimeout(hideTimer.current); setChromeVisible(true) } }, [keepChrome])
  function revealChrome(event?: { movementX?: number; movementY?: number }) {
    if (!full) return
    // alguns navegadores disparam mousemove sem movimento real ao mudar o layout (ex.: ao entrar em tela cheia)
    if (event && event.movementX === 0 && event.movementY === 0) return
    setChromeVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (!overChrome.current) setChromeVisible(false) }, 2500)
  }
  const chromeHidden = full && !chromeVisible && !keepChrome
  const chromeHover = { onMouseEnter: () => { overChrome.current = true }, onMouseLeave: () => { overChrome.current = false; revealChrome() } }
  async function fullscreen() {
    setMenu(false)
    try { if (document.fullscreenElement === container.current) await document.exitFullscreen(); else await container.current?.requestFullscreen() }
    catch { setError('A tela cheia não está disponível neste navegador.') }
  }
  function showTouchControls() {
    setTouchControls(true)
    clearTimeout(touchTimer.current)
    touchTimer.current = setTimeout(() => setTouchControls(false), 3500)
  }
  const width = dimensions.width || sample?.width, height = dimensions.height || sample?.height
  const size = width && height ? `${width} × ${height}` : 'Aguardando vídeo'
  const qualityText = selected ? describeQuality(selected) : 'Qualidade não informada'
  const limitation = share.isLocal ? sample?.limitation : share.report?.limitation
  const limitations: Record<string, string> = { cpu: 'Processamento / CPU', bandwidth: 'Banda disponível', none: 'Nenhuma', other: 'Outra' }
  const thumb = variant === 'thumb' && !full
  const audioOff = !share.isLocal && (share.hasAudio ? muted || share.audioMuted : false)
  const displayName = share.isLocal ? `${share.ownerName} (Você)` : share.ownerName

  return <section ref={container} style={style}
    className={`stage-tile is-${variant}${share.isLocal ? ' is-local' : ''}${full ? ' is-full' : ''}${chromeHidden ? ' chrome-hidden' : ''}${touchControls || keepChrome ? ' show-controls' : ''}`}
    aria-label={`Transmissão de ${share.ownerName}`}
    onMouseMove={(e) => revealChrome(e)} onPointerDown={() => revealChrome()} onKeyDown={() => revealChrome()}
    // miniatura: um clique troca o destaque. Grade: duplo clique destaca. Principal: duplo clique = tela cheia.
    onClick={thumb ? focus : undefined}
    onPointerUp={(e) => { if (e.pointerType === 'touch' && !thumb) showTouchControls() }}
    onDoubleClick={thumb ? undefined : variant === 'main' || full ? () => void fullscreen() : focus}
    title={thumb ? `Clique para destacar ${share.ownerName}` : undefined}>
    <video ref={video} className="stage-video" autoPlay muted playsInline aria-label={`Tela de ${share.ownerName}`} />
    {!share.videoReady && <div className="stage-loading"><span className="loader" />{thumb ? '' : 'Conectando à transmissão…'}</div>}

    <div className="stage-top" {...chromeHover}>
      <span className="stage-name" title={displayName}>{share.ownerName}{share.isLocal && <em> (Você)</em>}</span>
      <span className="stage-live">AO VIVO</span>
      {audioOff && <span className="stage-muted" title={share.audioMuted ? 'Emissor sem som' : 'Som silenciado por você'} aria-label="Som desligado"><Icon name="mute" size={13} /></span>}
      {!thumb && share.viewers && <span {...keepInside}><ViewersBadge viewers={share.viewers} isLocal={share.isLocal} /></span>}
    </div>

    {!thumb && <div className="stage-actions stage-controls" {...chromeHover} {...keepInside}>
      {variant === 'grid' && !full && <button title="Colocar em destaque" aria-label={`Destacar ${share.ownerName}`} onClick={focus}><Icon name="focus" size={17} /></button>}
      {canFloat && <button title={floating ? 'Voltar para a página' : 'Janela flutuante (fica por cima de outros programas)'} aria-label={`${floating ? 'Fechar janela flutuante' : 'Janela flutuante'} de ${share.ownerName}`} aria-pressed={floating} onClick={() => void toggleFloating()}><Icon name="popout" size={17} /></button>}
      <button title={full ? 'Sair da tela cheia' : 'Tela cheia'} aria-label={`Tela cheia de ${share.ownerName}`} onClick={() => void fullscreen()}><Icon name={full ? 'collapse' : 'expand'} size={17} /></button>
      <button ref={menuButton} aria-label={`Menu de ${share.ownerName}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => { const rect = menuButton.current!.getBoundingClientRect(); setMenuAnchor({ left: Math.max(8, Math.min(rect.right - 248, innerWidth - 256)), top: Math.max(8, Math.min(rect.bottom + 8, innerHeight - 340)) }); setMenu(!menu) }}>•••</button>
    </div>}

    {!thumb && <div className="stage-bottom stage-controls" {...chromeHover} {...keepInside}>
      <div className="stage-audio">
        {share.isLocal ? <span className="stage-chip"><Icon name={share.hasAudio ? 'volume' : 'mute'} size={15} />{share.hasAudio ? 'Áudio ativado' : 'Sem áudio nesta fonte'}</span> : share.hasAudio ? <>
          <button aria-label={`${muted ? 'Ativar som' : 'Silenciar'} de ${share.ownerName}`} onClick={() => { changeAudio(share.id, { muted: !muted, ...(preference.volume === 0 ? { volume: 0.8 } : {}) }); void client.startAudio().catch(() => undefined) }}><Icon name={muted || share.audioMuted ? 'mute' : 'volume'} size={17} /></button>
          <input aria-label={`Volume de ${share.ownerName}`} title={`Volume ${Math.round(preference.volume * 100)}%`} type="range" min="0" max="100" value={Math.round(preference.volume * 100)} onChange={(e) => changeAudio(share.id, { volume: Number(e.target.value) / 100, muted: false })} />
          {share.audioMuted && <span className="stage-chip">Emissor sem som</span>}
        </> : <span className="stage-chip"><Icon name="mute" size={15} /> Sem áudio</span>}
      </div>
      <button className={`stage-net net-${level}`} onClick={() => setInfo(!info)} title="Ping do transmissor até o servidor de mídia (verde < 50 ms, amarelo a partir de 50 ms, vermelho a partir de 150 ms)"><Icon name="signal" size={14} />{ping === undefined ? NETWORK_LABEL.unknown : `${Math.round(ping)} ms`}</button>
      <button className="stage-quality" onClick={() => setInfo(!info)} aria-label={`Qualidade de ${share.ownerName}`} title="Qualidade configurada e resolução real">{qualityText} · {size}{sample?.fps !== undefined ? ` · ${Math.round(sample.fps)} FPS` : ''}</button>
    </div>}

    {menu && createPortal(<div className="stream-floating-menu" style={{ left: menuAnchor.left, top: menuAnchor.top }} role="menu" aria-label={`Opções de ${share.ownerName}`} onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false) }}>
      {variant !== 'main' && <button role="menuitem" onClick={() => { focus(); setMenu(false) }}>Colocar em destaque</button>}<button role="menuitem" onClick={() => void fullscreen()}>Tela cheia</button>{canFloat && <button role="menuitem" onClick={() => void toggleFloating()}>{floating ? 'Fechar janela flutuante' : 'Janela flutuante'}</button>}
      <button role="menuitem" onClick={() => { setInfo(!info); setMenu(false) }}>Informações da transmissão</button>{hide && <button role="menuitem" onClick={() => { setMenu(false); hide() }}>Parar de assistir</button>}
      {share.isLocal && ownerActions && <><button role="menuitem" onClick={() => { setMenu(false); ownerActions.quality() }}>Alterar qualidade</button><button role="menuitem" onClick={() => { setMenu(false); ownerActions.source() }}>Trocar tela/janela</button><button role="menuitem" onClick={() => { setMenu(false); ownerActions.stop() }}>Parar transmissão</button></>}
    </div>, document.fullscreenElement ?? document.body)}
    {info && <div className="stream-info-panel" role="region" aria-label={`Diagnóstico de ${share.ownerName}`} {...keepInside}>
      <header><strong>Informações da transmissão</strong><button aria-label="Fechar informações" onClick={() => setInfo(false)}><Icon name="close" size={16} /></button></header><dl>
        {share.viewers && <><dt>Assistindo agora</dt><dd>{share.viewers.length ? share.viewers.map((v) => v.name).join(', ') : 'Ninguém'}</dd></>}
        <dt>Formato de vídeo</dt><dd>{share.isLocal ? describeEncoder(sample?.codec, sample?.implementation, sample?.hardware) : describeEncoder(share.report?.codec, share.report?.encoder, share.report?.hw)}</dd>
        {(share.isLocal ? ownerActions?.state?.codec?.reason : share.report?.reason) && <><dt>Por que esse formato</dt><dd>{share.isLocal ? ownerActions?.state?.codec?.reason : share.report?.reason}</dd></>}
        {!share.isLocal && sample?.codec && <><dt>Você decodifica por</dt><dd>{sample.hardware === undefined ? 'Não informado' : sample.hardware ? 'Placa de vídeo' : 'Processador'}</dd></>}
        <dt>Qualidade selecionada</dt><dd>{qualityText}</dd><dt>{share.isLocal ? 'Captura real' : 'Vídeo recebido'}</dt><dd>{size}</dd>
        {!share.isLocal && <><dt>Captura do emissor</dt><dd>{share.report?.captureWidth ? `${share.report.captureWidth} × ${share.report.captureHeight}` : 'Não informado'}</dd>
          <dt>Tela/janela original do emissor</dt><dd>{share.report?.sourceWidth ? `${share.report.sourceWidth} × ${share.report.sourceHeight}` : 'Não informado'}</dd>
          <dt>Resolução travada</dt><dd>{share.report?.locked === undefined ? 'Não informado (versão antiga — peça Ctrl+F5)' : share.report.locked ? 'Sim' : 'Não'}</dd>
          <dt>Versão do app do emissor</dt><dd>{share.report?.app ?? 'Antiga (antes do diagnóstico)'}</dd></>}
        {share.isLocal && <><dt>Versão do seu app</dt><dd>{APP_BUILD}</dd></>}
        <dt>{share.isLocal ? 'Vídeo codificado' : 'Emissor enviando'}</dt><dd>{(share.isLocal ? sample?.width : share.report?.sendWidth) ? `${share.isLocal ? sample?.width : share.report?.sendWidth} × ${share.isLocal ? sample?.height : share.report?.sendHeight}` : 'Aguardando amostra'}</dd>
        <dt>FPS reais {share.isLocal ? 'de envio' : 'recebidos'}</dt><dd>{sample?.fps === undefined ? '—' : Math.round(sample.fps)}</dd><dt>Ping emissor → SFU</dt><dd>{ping === undefined ? '—' : `${Math.round(ping)} ms`}</dd>
        {!share.isLocal && <><dt>Seu ping → SFU</dt><dd>{sample?.rttMs === undefined ? '—' : `${Math.round(sample.rttMs)} ms`}</dd></>}
        <dt>Bitrate {share.isLocal ? 'enviado' : 'recebido'}</dt><dd>{sample?.mbps === undefined ? '—' : `${sample.mbps.toFixed(2)} Mbps`}</dd><dt>Perda de pacotes</dt><dd>{sample?.lossPercent === undefined ? '—' : `${sample.lossPercent.toFixed(1)}%`}</dd>{!share.isLocal && <><dt>Travadas no último minuto</dt><dd>{sample?.freezesPerMinute === undefined ? '—' : sample.freezesPerMinute === 0 ? 'Nenhuma' : sample.freezesPerMinute}</dd></>}<dt>Limitação no emissor</dt><dd>{limitations[limitation ?? ''] ?? 'Não informada'}</dd>
      </dl><p>Ping é ida e volta até o servidor. Não mede o atraso total da imagem. Dados de envio são reportados pelo emissor.</p>
    </div>}
    {error && <div role="alert" className="stage-error" {...keepInside}>{error}<button aria-label="Fechar aviso" onClick={() => setError('')}>×</button></div>}
  </section>
}

/**
 * Palco das transmissões. viewMode = grid | focus; no destaque, focusedStreamId é a principal e as demais
 * formam a fileira de miniaturas. Todos os tiles ficam no MESMO container e só mudam de posição/tamanho:
 * trocar o modo ou o destaque não desmonta vídeos nem mexe na conexão WebRTC.
 */
export function StreamStage({ streams, viewMode, focusedStreamId, onFocus, client, hide, ownerActions }: {
  streams: ShareView[]
  viewMode: ViewMode
  focusedStreamId: string | null
  onFocus: (id: string) => void
  client: LiveKitRoomClient
  hide: (id: string) => void
  ownerActions?: OwnerActions
}) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [aspects, setAspects] = useState<Record<string, number>>({})
  // Desliza os tiles só quando muda o modo, o destaque ou quem transmite. Redimensionar a janela (ou girar o
  // celular) reposiciona na hora: animar isso deixaria o tile maior que o palco, cortado, durante a transição.
  const arrangement = `${viewMode}|${focusedStreamId}|${streams.map((s) => s.id).join(',')}`
  const lastArrangement = useRef(arrangement)
  const animateUntil = useRef(0)
  if (lastArrangement.current !== arrangement) {
    lastArrangement.current = arrangement
    animateUntil.current = Date.now() + 450
  }
  const animated = Date.now() < animateUntil.current
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    setSize({ width: el.clientWidth, height: el.clientHeight })
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }) })
    observer.observe(el); return () => observer.disconnect()
  }, [])
  // primeira disposição sem animação (nada "voa" do canto); depois, trocas de modo/destaque deslizam
  const layout = computeStageLayout({ ids: streams.map((s) => s.id), mode: viewMode, focusedId: focusedStreamId, width: size.width, height: size.height, aspects })
  return <div ref={host} className={`stream-stage stage-${viewMode}${animated ? ' animated' : ''}`} data-view-mode={viewMode}>
    {streams.map((share) => {
      const rect = layout[share.id]
      return <StreamTile key={share.id} share={share} client={client} variant={rect?.role ?? 'grid'}
        style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { visibility: 'hidden' }}
        focus={() => onFocus(share.id)} hide={share.isLocal ? undefined : () => hide(share.id)} ownerActions={share.isLocal ? ownerActions : undefined}
        onAspect={(aspect) => setAspects((old) => (Math.abs((old[share.id] ?? 0) - aspect) < 0.01 ? old : { ...old, [share.id]: aspect }))} />
    })}
  </div>
}
