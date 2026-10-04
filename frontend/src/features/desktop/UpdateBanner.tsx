import { useEffect, useState } from 'react'
import { velunBridge } from '../../desktop/velun'
import { DOWNLOAD_URL } from './DownloadApp'

/**
 * No app Velun Gx: mostra o download de uma versão nova e, quando termina, oferece reiniciar e atualizar na hora.
 * Se a última instalação não concluiu, diz isso claramente em vez de repetir o mesmo aviso.
 */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ version: string; percent: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const update = velunBridge()?.update
    if (!update) return
    let alive = true
    void update.status().then((ready) => { if (alive && ready) setVersion(ready.version) }).catch(() => undefined)
    void update.progress?.().then((current) => { if (alive && current) setProgress(current) }).catch(() => undefined)
    void update.failed?.().then((last) => { if (alive && last) setFailed(last.version) }).catch(() => undefined)
    const offReady = update.onReady((ready) => { setVersion(ready.version); setProgress(null); setDismissed(false); if (ready.installing) setInstalling(true) })
    const offProgress = update.onProgress?.((current) => setProgress(current))
    return () => { alive = false; offReady(); offProgress?.() }
  }, [])

  async function install() {
    setInstalling(true)
    const started = await velunBridge()?.update?.install().catch(() => false)
    if (!started) setInstalling(false)
  }

  if (dismissed) return null
  if (installing) {
    return <div className="update-banner" role="status"><span>Instalando a versão {version}… Uma janela de instalação vai aparecer e o Velun Gx abre sozinho no final. Não abra o app enquanto isso.</span></div>
  }
  if (failed) {
    return (
      <div className="update-banner failed" role="alert">
        <span>A atualização para a versão {failed} não foi concluída. {version ? 'Tente de novo e espere o Velun Gx abrir sozinho.' : 'Baixe o instalador e rode com o Velun Gx fechado.'}</span>
        {version && <button className="btn btn-primary" onClick={() => void install()}>Tentar de novo</button>}
        <a className="btn" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Baixar instalador</a>
        <button className="btn" onClick={() => setDismissed(true)}>Fechar</button>
      </div>
    )
  }
  if (!version) {
    if (!progress) return null
    return (
      <div className="update-banner downloading" role="status">
        <span>Baixando a versão {progress.version} do Velun Gx… {progress.percent}%</span>
        <span className="update-progress" aria-hidden="true"><span style={{ width: `${progress.percent}%` }} /></span>
        <button className="btn" onClick={() => setDismissed(true)} title="O download continua em segundo plano">Ocultar</button>
      </div>
    )
  }
  return (
    <div className="update-banner" role="status">
      <span>Nova versão do Velun Gx pronta ({version}).</span>
      <button className="btn btn-primary" onClick={() => void install()}>Reiniciar e atualizar</button>
      <button className="btn" onClick={() => setDismissed(true)} title="Ela será aplicada na próxima vez que você abrir o app">Depois</button>
    </div>
  )
}
