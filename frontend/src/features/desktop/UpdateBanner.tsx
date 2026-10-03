import { useEffect, useState } from 'react'
import { velunBridge } from '../../desktop/velun'

/**
 * No app Velun Gx: mostra o download de uma versão nova e, quando termina, oferece reiniciar e atualizar na hora.
 */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ version: string; percent: number } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const update = velunBridge()?.update
    if (!update) return
    let alive = true
    void update.status().then((ready) => { if (alive && ready) setVersion(ready.version) }).catch(() => undefined)
    void update.progress?.().then((current) => { if (alive && current) setProgress(current) }).catch(() => undefined)
    const offReady = update.onReady((ready) => { setVersion(ready.version); setProgress(null); setDismissed(false) })
    const offProgress = update.onProgress?.((current) => setProgress(current))
    return () => { alive = false; offReady(); offProgress?.() }
  }, [])

  if (dismissed) return null
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
  async function install() {
    setInstalling(true)
    const started = await velunBridge()?.update?.install().catch(() => false)
    if (!started) setInstalling(false)
  }
  return (
    <div className="update-banner" role="status">
      <span>{installing ? `Instalando a versão ${version}… o Velun Gx abre de novo em alguns segundos.` : `Nova versão do Velun Gx pronta (${version}).`}</span>
      {!installing && <>
        <button className="btn btn-primary" onClick={() => void install()}>Reiniciar e atualizar</button>
        <button className="btn" onClick={() => setDismissed(true)} title="Ela será instalada quando você fechar o app">Depois</button>
      </>}
    </div>
  )
}
