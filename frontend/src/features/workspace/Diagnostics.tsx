import { useStreamContext } from './StreamContext'
export function Diagnostics() {
  const { samples } = useStreamContext()
  const error = ''
  const value = (number: number | undefined, unit: string) => number === undefined ? '—' : `${number.toFixed(1)} ${unit}`
  return <><h2 id="dialog-title">Diagnóstico da conexão</h2><p className="muted small">Dados do WebRTC atualizados a cada 2 segundos. RTT é o tempo de ida e volta, não a latência ponta a ponta. Perda de pacotes acumulada nesta track.</p>{samples.length ? <div className="diagnostic-list">{samples.map((s, i) => <section key={`${s.name}-${i}`}><h3>{s.name}{s.local ? ' · enviando' : ' · recebendo'}</h3><dl><dt>Resolução</dt><dd>{s.width && s.height ? `${s.width} × ${s.height}` : '—'}</dd><dt>FPS</dt><dd>{value(s.fps, '')}</dd><dt>Bitrate</dt><dd>{value(s.mbps, 'Mbps')}</dd><dt>RTT</dt><dd>{value(s.rttMs, 'ms')}</dd><dt>Jitter</dt><dd>{value(s.jitterMs, 'ms')}</dd><dt>Packet loss</dt><dd>{value(s.lossPercent, '%')}</dd>{s.limitation && <><dt>Limitação</dt><dd>{s.limitation}</dd></>}</dl></section>)}</div> : <p className="muted">Nenhuma track sendo enviada ou recebida. Comece ou assista a uma transmissão.</p>}{error && <p role="alert">{error}</p>}</>
}
