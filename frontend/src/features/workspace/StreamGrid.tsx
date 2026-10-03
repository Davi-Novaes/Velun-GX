import { useEffect, useRef, useState } from 'react'
import type { LiveKitRoomClient } from '../../media/LiveKitRoomClient'
import type { LocalShare, ShareView, ShareViewer } from '../../media/RoomClient'
import { describeQuality } from '../../media/presets'
import { fitGrid } from './grid'
import { NETWORK_LABEL, networkLevel } from './network'
import { APP_BUILD } from '../../build'
import { Icon } from './Icons'
import { useStreamContext } from './StreamContext'

/** Quantas pessoas estão recebendo a transmissão; clicar mostra os nomes. */
export function ViewersBadge({ viewers, isLocal }: { viewers: ShareViewer[]; isLocal: boolean }) {
  const [open, setOpen] = useState(false)
  const others = viewers.filter((v) => !v.isLocal)
  const names = viewers.map((v) => v.name).join(', ')
  return <span className="stream-viewers" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}>
    <button aria-expanded={open} aria-label={`${viewers.length} ${viewers.length === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}`} title={viewers.length ? `Assistindo: ${names}` : 'Ninguém assistindo agora'} onClick={() => setOpen(!open)}>
      <Icon name="eye" size={14} />{viewers.length}
    </button>
    {open && <div className="viewers-popover" role="dialog" aria-label="Quem está assistindo">
      <strong>{isLocal ? 'Assistindo você' : 'Assistindo'}</strong>
      {viewers.length ? <ul>{viewers.map((v) => <li key={v.identity}><span className="stream-avatar">{v.name.slice(0, 2).toUpperCase()}</span>{v.name}</li>)}</ul>
        : <p>{isLocal ? 'Ninguém está assistindo sua transmissão agora.' : 'Ninguém assistindo agora.'}</p>}
      {isLocal && others.length > 0 && <small>Conta só quem está recebendo o vídeo agora.</small>}
    </div>}
  </span>
}

export function StreamTile({ share, client, focus, hide, compact = false, ownerActions }: { share: ShareView; client: LiveKitRoomClient; focus: () => void; hide?: () => void; compact?: boolean; ownerActions?: OwnerActions }) {
  const video = useRef<HTMLVideoElement>(null)
  const container = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState(false)
  const [full, setFull] = useState(false)
  // Em tela cheia as barras ficam escondidas e só aparecem quando o mouse se move (somem de novo após 2,5 s parado).
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const overChrome = useRef(false)
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
  useEffect(() => { if (video.current) return client.attachShareVideo(share.id, video.current) }, [client, share.id, share.videoReady, share.trackVersion])
  useEffect(() => {
    const el = video.current
    if (!el) return
    const update = () => setDimensions({ width: el.videoWidth, height: el.videoHeight })
    update(); el.addEventListener('resize', update); el.addEventListener('loadedmetadata', update)
    return () => { el.removeEventListener('resize', update); el.removeEventListener('loadedmetadata', update) }
  }, [share.trackVersion])
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
    return () => { document.removeEventListener('fullscreenchange', change); clearTimeout(hideTimer.current) }
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
  const size = dimensions.width ? `${dimensions.width} × ${dimensions.height}` : 'Aguardando vídeo'
  const qualityText = selected ? describeQuality(selected) : 'Qualidade não informada'
  const limitation = share.isLocal ? sample?.limitation : share.report?.limitation
  const limitations: Record<string, string> = { cpu: 'Processamento / CPU', bandwidth: 'Banda disponível', none: 'Nenhuma', other: 'Outra' }
  return <section ref={container} className={`stream-tile${compact ? ' compact' : ''}${chromeHidden ? ' chrome-hidden' : ''}`} aria-label={`Transmissão de ${share.ownerName}`}
    onMouseMove={(e) => revealChrome(e)} onPointerDown={() => revealChrome()} onKeyDown={() => revealChrome()}>
    <header className="stream-card-header" {...chromeHover}>
      <button className="stream-name" onClick={focus}><span className="stream-avatar">{share.ownerName.slice(0, 2).toUpperCase()}</span><span>{share.isLocal ? 'Sua transmissão' : share.ownerName}</span></button>
      <span className="live-dot">AO VIVO</span>
      {share.viewers && <ViewersBadge viewers={share.viewers} isLocal={share.isLocal} />}
      <div className="tile-actions">
        {!compact && <button title="Ver em destaque" aria-label={`Destacar ${share.ownerName}`} onClick={focus}><Icon name="focus" /></button>}
        {canFloat && !compact && <button title={floating ? 'Voltar para a página' : 'Janela flutuante (fica por cima de outros programas)'} aria-label={`${floating ? 'Fechar janela flutuante' : 'Janela flutuante'} de ${share.ownerName}`} aria-pressed={floating} onClick={() => void toggleFloating()}><Icon name="popout" /></button>}
        <button title={full ? 'Sair da tela cheia' : 'Tela cheia'} aria-label={`Tela cheia de ${share.ownerName}`} onClick={() => void fullscreen()}><Icon name={full ? 'collapse' : 'expand'} /></button>
        <button aria-label={`Menu de ${share.ownerName}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>•••</button>
      </div>
    </header>
    <div className="stream-picture">
      <video ref={video} autoPlay muted playsInline aria-label={`Tela de ${share.ownerName}`} onClick={focus} />
      {!share.videoReady && <div className="stream-loading"><span className="loader" />Conectando à transmissão…</div>}
      <button className="stream-quality-badge" onClick={() => setInfo(!info)} aria-label={`Qualidade de ${share.ownerName}`} title="Qualidade configurada e resolução real"><span>{qualityText}</span><span>{size}{sample?.fps !== undefined ? ` · ${Math.round(sample.fps)} FPS reais` : ''}</span></button>
    </div>
    {!compact && <footer className="stream-card-footer" {...chromeHover}>
      <button className={`stream-network net-${level}`} onClick={() => setInfo(!info)} title="Ping do transmissor até o servidor de mídia (verde < 50 ms, amarelo a partir de 50 ms, vermelho a partir de 150 ms)"><Icon name="signal" size={15} />{ping === undefined ? NETWORK_LABEL.unknown : `${Math.round(ping)} ms`}<span>{ping === undefined ? '' : NETWORK_LABEL[level]}</span></button>
      <div className="stream-audio-controls">
        {share.isLocal ? <button disabled={!share.hasAudio} onClick={ownerActions?.audio} title={share.hasAudio ? 'Ativar ou desativar envio de áudio' : 'Captura sem faixa de áudio'}><Icon name={share.audioMuted ? 'mute' : 'volume'} size={16} /><span>{share.hasAudio ? share.audioMuted ? 'Áudio pausado' : 'Áudio ativado' : 'Sem áudio'}</span></button> : share.hasAudio ? <>
          <button aria-label={`${muted ? 'Ativar som' : 'Silenciar'} de ${share.ownerName}`} onClick={() => { changeAudio(share.id, { muted: !muted, ...(preference.volume === 0 ? { volume: 0.8 } : {}) }); void client.startAudio().catch(() => undefined) }}><Icon name={muted || share.audioMuted ? 'mute' : 'volume'} size={17} /></button>
          <input aria-label={`Volume de ${share.ownerName}`} title={`Volume ${Math.round(preference.volume * 100)}%`} type="range" min="0" max="100" value={Math.round(preference.volume * 100)} onChange={(e) => changeAudio(share.id, { volume: Number(e.target.value) / 100, muted: false })} />
          {share.audioMuted && <span>Emissor sem som</span>}
        </> : <span className="audio-unavailable"><Icon name="mute" size={15} /> Sem áudio</span>}
      </div>
    </footer>}
    {menu && <div className="tile-menu" role="menu" onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false) }}>
      <button role="menuitem" onClick={() => { focus(); setMenu(false) }}>Ver em destaque</button><button role="menuitem" onClick={() => void fullscreen()}>Tela cheia</button>{canFloat && <button role="menuitem" onClick={() => void toggleFloating()}>{floating ? 'Fechar janela flutuante' : 'Janela flutuante'}</button>}
      <button role="menuitem" onClick={() => { setInfo(!info); setMenu(false) }}>Informações da transmissão</button>{hide && <button role="menuitem" onClick={hide}>Parar de assistir</button>}
      {share.isLocal && ownerActions && <><button role="menuitem" onClick={() => { setMenu(false); ownerActions.quality() }}>Alterar qualidade</button><button role="menuitem" onClick={() => { setMenu(false); ownerActions.source() }}>Trocar tela/janela</button><button role="menuitem" onClick={ownerActions.stop}>Parar transmissão</button></>}
    </div>}
    {info && <div className="stream-info-panel" role="region" aria-label={`Diagnóstico de ${share.ownerName}`}>
      <header><strong>Informações da transmissão</strong><button aria-label="Fechar informações" onClick={() => setInfo(false)}><Icon name="close" size={16} /></button></header><dl>
        {share.viewers && <><dt>Assistindo agora</dt><dd>{share.viewers.length ? share.viewers.map((v) => v.name).join(', ') : 'Ninguém'}</dd></>}
        <dt>Qualidade selecionada</dt><dd>{qualityText}</dd><dt>{share.isLocal ? 'Captura real' : 'Vídeo recebido'}</dt><dd>{size}</dd>
        {!share.isLocal && <><dt>Captura do emissor</dt><dd>{share.report?.captureWidth ? `${share.report.captureWidth} × ${share.report.captureHeight}` : 'Não informado'}</dd>
          <dt>Tela/janela original do emissor</dt><dd>{share.report?.sourceWidth ? `${share.report.sourceWidth} × ${share.report.sourceHeight}` : 'Não informado'}</dd>
          <dt>Resolução travada</dt><dd>{share.report?.locked === undefined ? 'Não informado (versão antiga — peça Ctrl+F5)' : share.report.locked ? 'Sim' : 'Não'}</dd>
          <dt>Versão do app do emissor</dt><dd>{share.report?.app ?? 'Antiga (antes do diagnóstico)'}</dd></>}
        {share.isLocal && <><dt>Versão do seu app</dt><dd>{APP_BUILD}</dd></>}
        <dt>{share.isLocal ? 'Vídeo codificado' : 'Emissor enviando'}</dt><dd>{(share.isLocal ? sample?.width : share.report?.sendWidth) ? `${share.isLocal ? sample?.width : share.report?.sendWidth} × ${share.isLocal ? sample?.height : share.report?.sendHeight}` : 'Aguardando amostra'}</dd>
        <dt>FPS reais {share.isLocal ? 'de envio' : 'recebidos'}</dt><dd>{sample?.fps === undefined ? '—' : Math.round(sample.fps)}</dd><dt>Ping emissor → SFU</dt><dd>{ping === undefined ? '—' : `${Math.round(ping)} ms`}</dd>
        {!share.isLocal && <><dt>Seu ping → SFU</dt><dd>{sample?.rttMs === undefined ? '—' : `${Math.round(sample.rttMs)} ms`}</dd></>}
        <dt>Bitrate {share.isLocal ? 'enviado' : 'recebido'}</dt><dd>{sample?.mbps === undefined ? '—' : `${sample.mbps.toFixed(2)} Mbps`}</dd><dt>Perda de pacotes</dt><dd>{sample?.lossPercent === undefined ? '—' : `${sample.lossPercent.toFixed(1)}%`}</dd><dt>Limitação no emissor</dt><dd>{limitations[limitation ?? ''] ?? 'Não informada'}</dd>
      </dl><p>Ping é ida e volta até o servidor. Não mede o atraso total da imagem. Dados de envio são reportados pelo emissor.</p>
    </div>}
    {error && <div role="alert" className="stream-info">{error}</div>}
  </section>
}

export function StreamGrid({ shares, client, focus, hide, ownerActions }: { shares: ShareView[]; client: LiveKitRoomClient; focus: (id: string) => void; hide: (id: string) => void; ownerActions?: OwnerActions }) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }) })
    observer.observe(host.current); return () => observer.disconnect()
  }, [])
  const layout = fitGrid(shares.length, size.width, size.height, 16 / 9, 16, 76)
  return <div className="stream-grid-host" ref={host}><div className="stream-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, ${layout.width}px)`, gridAutoRows: `${layout.height + 76}px` }}>{shares.map((share) => <StreamTile key={share.id} share={share} client={client} focus={() => focus(share.id)} hide={() => hide(share.id)} ownerActions={ownerActions} />)}</div></div>
}
export interface OwnerActions { quality: () => void; source: () => void; stop: () => void; audio?: () => void; state: LocalShare | null }
