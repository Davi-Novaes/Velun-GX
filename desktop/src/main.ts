import { X509Certificate } from 'node:crypto'
import path from 'node:path'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, session, shell, type Session } from 'electron'
import { AudioHelper, type SelectedSource } from './audioHelper'
import { PINNED_CERTIFICATES, PINNED_HOSTS, SERVER_URL } from './config'
import { choose } from './picker'
import { runSmoke } from './smoke'
import { runLoopbackSmoke } from './smokeLoopback'
import { runShareSmoke } from './smokeShare'
import { installNow, startAutoUpdate, updateState } from './updater'

// Transmissão não pode desacelerar com a janela minimizada ou atrás de um jogo
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.setAppUserModelId('gx.velun.app')

const audio = new AudioHelper()
let mainWindow: BrowserWindow | null = null
let selectedSource: SelectedSource | null = null

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

function start(): void {
  Menu.setApplicationMenu(null)
  const ses = session.defaultSession
  pinServerCertificate(ses)
  // o componente de áudio roda de dentro da pasta do app: precisa ter saído para o instalador trocar os arquivos
  startAutoUpdate(() => mainWindow, pinServerCertificate, () => audio.stopAndWait(2000))

  // Permissões só para o próprio sistema
  const allowed = new Set(['media', 'display-capture', 'fullscreen', 'notifications', 'clipboard-sanitized-write', 'speaker-selection'])
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(isServer(contents.getURL()) && allowed.has(permission)))
  ses.setPermissionCheckHandler((_contents, permission, origin) => isServer(origin) && allowed.has(permission))

  // getDisplayMedia da página abre o seletor do app. O áudio NÃO vem daqui: vem do VelunAudio (sem o Discord).
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const parent = mainWindow
    if (!parent || !isServer(request.securityOrigin)) return callback({})
    // autoteste: escolhe a primeira tela sem abrir o seletor
    const picked = process.env.VELUN_SMOKE_PICK === '1' ? desktopCapturer.getSources({ types: ['screen'] }).then(([first]) => (first ? { id: first.id, name: first.name, kind: 'screen' as const } : null)) : choose(parent)
    picked.then((choice) => {
      selectedSource = choice
      // Áudio pedido pela página = som do PC inteiro (Windows 10, onde não existe captura por programa e a
      // pessoa escolheu transmitir mesmo assim). No Windows 11 a página não pede: o som vem do VelunAudio.
      callback(choice ? { video: { id: choice.id, name: choice.name }, ...(request.audioRequested ? { audio: 'loopback' as const } : {}) } : {})
    }).catch(() => callback({}))
  }, { useSystemPicker: false })

  ipcMain.handle('velun:selected-source', (event) => (event.sender === mainWindow?.webContents ? selectedSource : null))
  ipcMain.handle('velun:update:status', (event) => (event.sender === mainWindow?.webContents ? updateState().ready : null))
  ipcMain.handle('velun:update:progress', (event) => (event.sender === mainWindow?.webContents ? updateState().downloading : null))
  ipcMain.handle('velun:update:failed', (event) => (event.sender === mainWindow?.webContents ? updateState().failed : null))
  ipcMain.handle('velun:update:install', async (event) => {
    if (event.sender !== mainWindow?.webContents) return false
    return installNow()
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
  if (process.env.VELUN_SMOKE_LOOPBACK === '1') runLoopbackSmoke(window)
  // só contra o site local de desenvolvimento: cria conta e servidor de teste
  if (process.env.VELUN_SMOKE_SHARE === '1' && /^http:\/\/localhost(:\d+)?$/.test(SERVER_URL.origin)) runShareSmoke(window)
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
