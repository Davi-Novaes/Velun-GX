import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow, session } from 'electron'
import { autoUpdater } from 'electron-updater'

export interface UpdateState {
  /** Versão nova sendo baixada (a página mostra "Baixando… N%"). */
  downloading: { version: string; percent: number } | null
  /** Versão nova baixada e pronta (a página mostra "Reiniciar e atualizar"). */
  ready: { version: string } | null
  /** A última tentativa de instalar não terminou (o app abriu ainda na versão antiga). */
  failed: { version: string } | null
}

const state: UpdateState = { downloading: null, ready: null, failed: null }
let window: () => BrowserWindow | null = () => null
let beforeInstall: () => Promise<void> = async () => undefined
let startedAt = 0
/** Versão já baixada encontrada logo ao abrir o app: é aplicada na hora (como no Discord). */
const APPLY_ON_OPEN_MS = 20_000

/** Registro do atualizador em %APPDATA%\Velun Gx\logs\updater.log (para diagnosticar falhas de quem usa). */
function logFile(): string {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, 'updater.log')
}

export function log(level: string, message: unknown): void {
  try {
    const file = logFile()
    if (existsSync(file) && statSync(file).size > 1_000_000) renameSync(file, `${file}.old`)
    appendFileSync(file, `${new Date().toISOString()} [${level}] v${app.getVersion()} ${message instanceof Error ? message.stack ?? message.message : String(message)}\n`)
  } catch {
    // registro é auxiliar: nunca derruba o app
  }
}

/** Arquivo gravado antes de instalar; se o app abrir de novo na versão antiga, a instalação falhou. */
function attemptFile(): string {
  return path.join(app.getPath('userData'), 'update-attempt.json')
}

function newer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const [a, b] = [parse(candidate), parse(current)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

function checkPreviousAttempt(): void {
  try {
    if (!existsSync(attemptFile())) return
    const attempt = JSON.parse(readFileSync(attemptFile(), 'utf8')) as { from: string; to: string; at: string }
    if (newer(attempt.to, app.getVersion())) {
      state.failed = { version: attempt.to }
      log('warn', `instalação da ${attempt.to} (iniciada em ${attempt.at}) não concluiu; app abriu na ${app.getVersion()}`)
    } else {
      log('info', `atualização ${attempt.from} -> ${attempt.to} concluída`)
    }
    rmSync(attemptFile(), { force: true })
  } catch (error) {
    log('error', error)
  }
}

function send(channel: string, value: unknown): void {
  const target = window()
  if (target && !target.isDestroyed()) target.webContents.send(channel, value)
}

/**
 * Baixa versões novas em segundo plano (de /downloads/ no servidor). NUNCA instala ao fechar: fechar pode ser o
 * Windows desligando, e um desligamento no meio da instalação deixava o PC sem o app (a antiga já removida, a
 * nova incompleta). A versão baixada é aplicada ao ABRIR o app, com janela de instalação, ou pelo botão.
 */
export function startAutoUpdate(getWindow: () => BrowserWindow | null, pin: (ses: Electron.Session) => void, prepareInstall: () => Promise<void>): void {
  window = getWindow
  beforeInstall = prepareInstall
  startedAt = Date.now()
  if (!app.isPackaged) return
  checkPreviousAttempt()
  autoUpdater.logger = { info: (m: unknown) => log('info', m), warn: (m: unknown) => log('warn', m), error: (m: unknown) => log('error', m), debug: () => undefined }
  // o atualizador usa uma sessão de rede própria: precisa da mesma fixação de certificado
  pin(session.fromPartition('electron-updater', { cache: false }))
  // testes: aponta o atualizador para outra pasta (ex.: http://127.0.0.1:8099/) sem tocar no servidor
  if (process.env.VELUN_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.VELUN_UPDATE_URL })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('error', (error) => log('error', error)) // sem rede/servidor: tenta de novo mais tarde
  autoUpdater.on('update-available', (info) => {
    state.downloading = { version: info.version, percent: 0 }
    send('velun:update-progress', state.downloading)
  })
  autoUpdater.on('download-progress', (progress) => {
    if (!state.downloading) return
    const percent = Math.floor(progress.percent)
    if (percent === state.downloading.percent) return // no máximo uma mensagem por ponto percentual
    state.downloading = { ...state.downloading, percent }
    send('velun:update-progress', state.downloading)
  })
  autoUpdater.on('update-downloaded', (info) => {
    state.downloading = null
    state.ready = { version: info.version }
    // baixada numa sessão anterior (ou em segundos agora): aplica já, enquanto a pessoa está abrindo o app.
    // Se essa mesma versão já falhou uma vez, não insiste: mostra o aviso com "Tentar de novo".
    const applyNow = Date.now() - startedAt < APPLY_ON_OPEN_MS && state.failed?.version !== info.version && !isTest()
    send('velun:update-ready', { ...state.ready, installing: applyNow })
    if (applyNow) void installNow()
  })
  const check = () => { void autoUpdater.checkForUpdates().catch((error: unknown) => log('error', error)) }
  check()
  setInterval(check, 4 * 60 * 60 * 1000).unref()
}

function isTest(): boolean {
  return Boolean(process.env.VELUN_UPDATE_URL) || process.env.VELUN_SMOKE === '1'
}

export function updateState(): UpdateState {
  return state
}

/**
 * Fecha e instala a versão baixada. O instalador mostra a janela de progresso (antes era silencioso e,
 * sem nada na tela, quem abria o app de novo no meio da instalação fazia ela falhar) e abre o app ao terminar.
 */
export async function installNow(): Promise<boolean> {
  if (!state.ready || isTest()) return false
  try {
    writeFileSync(attemptFile(), JSON.stringify({ from: app.getVersion(), to: state.ready.version, at: new Date().toISOString() }))
  } catch (error) {
    log('error', error)
  }
  log('info', `instalando ${state.ready.version}`)
  await beforeInstall()
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
}
