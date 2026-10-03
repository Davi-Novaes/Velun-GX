import { X509Certificate } from 'node:crypto'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type Session } from 'electron'
import { autoUpdater } from 'electron-updater'
import { AudioHelper, type SelectedSource } from './audioHelper'
import { PINNED_CERTIFICATES, PINNED_HOSTS, SERVER_URL } from './config'
import { choose } from './picker'
import { runSmoke } from './smoke'

// Transmissão não pode desacelerar com a janela minimizada ou atrás de um jogo
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.setAppUserModelId('gx.velun.app')

const audio = new AudioHelper()
let mainWindow: BrowserWindow | null = null
let selectedSource: SelectedSource | null = null
/** Versão nova já baixada e pronta para instalar (a página mostra o botão "Reiniciar e atualizar"). */
let readyUpdate: { version: string } | null = null
/** Versão nova sendo baixada agora (a página mostra "Baixando atualização… N%"). */
let downloading: { version: string; percent: number } | null = null

function isServer(url: string): boolean {
  try { return new URL(url).origin === SERVER_URL.origin } catch { return false }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start).catch((error: unknown) => {
    dialog.showErrorBox('Velun Gx', `Não foi possível iniciar: ${String(error)}`)
    app.quit()
  })
}

/**
 * Certificado autoassinado: aceito SOMENTE para o servidor e com a impressão digital fixada.
 * Qualquer outro site segue a verificação normal do Chromium.
 */
function pinServerCertificate(ses: Session): void {
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.verificationResult === 'net::OK') return callback(-3)
    if (PINNED_HOSTS.has(request.hostname)) {
      const fingerprint = new X509Certificate(request.certificate.data).fingerprint256
      return callback(PINNED_CERTIFICATES.includes(fingerprint) ? 0 : -2)
    }
    callback(-3)
  })
}

/** Baixa versões novas em segundo plano (de /downloads/ no servidor) e instala ao fechar o app. */
function startAutoUpdate(): void {
  if (!app.isPackaged) return
  // o atualizador usa uma sessão de rede própria: precisa da mesma fixação de certificado
  pinServerCertificate(session.fromPartition('electron-updater', { cache: false }))
  // testes: aponta o atualizador para outra pasta (ex.: http://127.0.0.1:8099/) sem tocar no servidor
  if (process.env.VELUN_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.VELUN_UPDATE_URL })
  autoUpdater.autoDownload = true
  // Testes (feed trocado ou autoteste) NUNCA instalam ao fechar: o instalador usa a mesma pasta do app
  // instalado da pessoa e fecharia/substituiria o Velun Gx dela.
  autoUpdater.autoInstallOnAppQuit = !process.env.VELUN_UPDATE_URL && process.env.VELUN_SMOKE !== '1'
  autoUpdater.on('error', () => undefined) // sem rede/servidor: tenta de novo mais tarde
  autoUpdater.on('update-available', (info) => {
    downloading = { version: info.version, percent: 0 }
    mainWindow?.webContents.send('velun:update-progress', downloading)
  })
  autoUpdater.on('download-progress', (progress) => {
    if (!downloading) return
    const percent = Math.floor(progress.percent)
    if (percent === downloading.percent) return // no máximo uma mensagem por ponto percentual
    downloading = { ...downloading, percent }
    mainWindow?.webContents.send('velun:update-progress', downloading)
  })
  autoUpdater.on('update-downloaded', (info) => {
    downloading = null
    readyUpdate = { version: info.version }
    mainWindow?.webContents.send('velun:update-ready', readyUpdate)
  })
  const check = () => { void autoUpdater.checkForUpdates().catch(() => undefined) }
  check()
  setInterval(check, 4 * 60 * 60 * 1000).unref()
}

function start(): void {
  Menu.setApplicationMenu(null)
  const ses = session.defaultSession
  pinServerCertificate(ses)
  startAutoUpdate()

  // Permissões só para o próprio sistema
  const allowed = new Set(['media', 'display-capture', 'fullscreen', 'notifications', 'clipboard-sanitized-write', 'speaker-selection'])
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(isServer(contents.getURL()) && allowed.has(permission)))
  ses.setPermissionCheckHandler((_contents, permission, origin) => isServer(origin) && allowed.has(permission))

  // getDisplayMedia da página abre o seletor do app. O áudio NÃO vem daqui: vem do VelunAudio (sem o Discord).
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const parent = mainWindow
    if (!parent || !isServer(request.securityOrigin)) return callback({})
    choose(parent).then((choice) => {
      selectedSource = choice
      callback(choice ? { video: { id: choice.id, name: choice.name } } : {})
    }).catch(() => callback({}))
  }, { useSystemPicker: false })

  ipcMain.handle('velun:selected-source', (event) => (event.sender === mainWindow?.webContents ? selectedSource : null))
  ipcMain.handle('velun:update:status', (event) => (event.sender === mainWindow?.webContents ? readyUpdate : null))
  ipcMain.handle('velun:update:progress', (event) => (event.sender === mainWindow?.webContents ? downloading : null))
  ipcMain.handle('velun:update:install', (event) => {
    if (event.sender !== mainWindow?.webContents || !readyUpdate) return false
    audio.stop()
    // instala sem perguntar nada e abre o app de novo
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
    return true
  })
  ipcMain.handle('velun:audio:probe', () => audio.probe())
  ipcMain.handle('velun:audio:start', async (event, scope: unknown) => {
    if (event.sender !== mainWindow?.webContents || !isServer(event.senderFrame?.url ?? '')) throw new Error('Origem não autorizada.')
    const probe = await audio.probe()
    if (!probe.supported) throw new Error(probe.message ?? 'Este Windows não permite separar o som por programa.')
    return audio.start(event.sender, scope === 'shared' ? 'shared' : 'system', selectedSource)
  })
  ipcMain.handle('velun:audio:stop', (event) => { if (event.sender === mainWindow?.webContents) audio.stop() })

  createWindow()
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Velun Gx',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--velun-version=${app.getVersion()}`],
    },
  })
  mainWindow = window
  window.on('page-title-updated', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    audio.stop()
    mainWindow = null
  })
  window.webContents.on('render-process-gone', () => audio.stop())

  // Navegação só dentro do sistema; links externos abrem no navegador padrão
  window.webContents.on('will-navigate', (event, url) => {
    if (isServer(url)) return
    event.preventDefault()
    openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3: navegação substituída
    void window.loadFile(path.join(__dirname, '..', 'picker', 'offline.html'), { query: { reason: `${description} (${code})`, url } })
  })

  if (process.env.VELUN_SMOKE === '1') runSmoke(window)
  void window.loadURL(new URL('/app', SERVER_URL).toString())
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.toString())
  } catch {
    // URL inválida: ignora
  }
}

ipcMain.on('velun:retry', (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) void mainWindow.loadURL(new URL('/app', SERVER_URL).toString())
})

app.on('window-all-closed', () => {
  audio.stop()
  app.quit()
})
