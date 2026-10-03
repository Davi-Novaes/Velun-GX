import { useEffect, useState } from 'react'
import { APP_BUILD } from '../../build'
import { velunBridge } from '../../desktop/velun'

export const DOWNLOAD_URL = '/downloads/VelunGx-Setup.exe'

/** Versão publicada do app (lida do latest.yml do atualizador); null se ainda não houver instalador no servidor. */
export function useLatestAppVersion(): string | null | undefined {
  const [version, setVersion] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    fetch('/downloads/latest.yml', { cache: 'no-store' })
      .then(async (response) => (response.ok ? (await response.text()).match(/^version:\s*(\S+)/m)?.[1] ?? null : null))
      .catch(() => null)
      .then((value) => { if (alive) setVersion(value) })
    return () => { alive = false }
  }, [])
  return version
}

/** Versão em uso, discreta no canto: a do app Velun Gx, ou a data do site no navegador. */
export function AppVersion() {
  const bridge = velunBridge()
  return <small className="app-version" title={bridge ? `Velun Gx ${bridge.version} · site ${APP_BUILD}` : `Versão do site: ${APP_BUILD}`}>
    {bridge ? `Velun Gx ${bridge.version}` : `site ${APP_BUILD}`}
  </small>
}

/** "0.10.0" é mais nova que "0.9.3"; versões iguais ou mais antigas que a instalada não contam. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const [a, b] = [parse(candidate), parse(current)]
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/**
 * Convite para baixar o Velun Gx (Windows). Dentro do próprio app mostra só a versão em uso.
 * compact: botão pequeno para barras; completo: cartão com explicação.
 */
export function DownloadApp({ compact = false }: { compact?: boolean }) {
  const bridge = velunBridge()
  const latest = useLatestAppVersion()
  if (bridge) {
    if (compact) return null
    const outdated = latest && isNewerVersion(latest, bridge.version)
    return <p className="muted small download-app-version">Você está usando o Velun Gx {bridge.version}{outdated ? ` · a versão ${latest} será instalada ao fechar o app` : ''}.</p>
  }
  if (!latest) return null
  if (compact) {
    return <a className="btn download-app-compact" href={DOWNLOAD_URL} download title={`Baixar o Velun Gx ${latest} para Windows`}>⬇<span>Baixar app</span></a>
  }
  return (
    <div className="download-app">
      <div>
        <strong>Velun Gx para Windows</strong>
        <small className="muted">Transmita a tela inteira com o som do PC sem a call do Discord. Versão {latest} · Windows 11.</small>
      </div>
      <a className="btn btn-primary" href={DOWNLOAD_URL} download>Baixar</a>
    </div>
  )
}
