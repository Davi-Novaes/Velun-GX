import path from 'node:path'
import { BrowserWindow, desktopCapturer, ipcMain, type DesktopCapturerSource } from 'electron'
import type { SelectedSource } from './audioHelper'

export interface PickerSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
  icon: string | null
}

/** Títulos das janelas do próprio app: nunca aparecem no seletor (espelho infinito e eco). */
const OWN_TITLES = new Set(['Velun Gx', 'Velun Gx — Escolha o que transmitir'])

/**
 * Seletor de tela/janela no estilo do Discord, aberto quando a página chama getDisplayMedia.
 * Resolve com a fonte escolhida ou null se a pessoa cancelar.
 */
export function choose(parent: BrowserWindow): Promise<SelectedSource | null> {
  return new Promise((resolve) => {
    let sources = new Map<string, DesktopCapturerSource>()
    const picker = new BrowserWindow({
      parent,
      modal: true,
      width: 860,
      height: 620,
      minWidth: 560,
      minHeight: 420,
      title: 'Velun Gx — Escolha o que transmitir',
      backgroundColor: '#15171c',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'pickerPreload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })

    let done = false
    const finish = (choice: SelectedSource | null) => {
      if (done) return
      done = true
      ipcMain.removeHandler('picker:sources')
      ipcMain.removeAllListeners('picker:choose')
      if (!picker.isDestroyed()) picker.close()
      resolve(choice)
    }

    ipcMain.handle('picker:sources', async (event) => {
      if (event.sender !== picker.webContents) return []
      const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
      sources = new Map(list.map((s) => [s.id, s]))
      return list
        .filter((s) => !OWN_TITLES.has(s.name))
        .map<PickerSource>((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
          icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }))
    })
    ipcMain.on('picker:choose', (event, id: unknown) => {
      if (event.sender !== picker.webContents) return
      const source = typeof id === 'string' ? sources.get(id) : undefined
      finish(source ? { id: source.id, name: source.name, kind: source.id.startsWith('screen:') ? 'screen' : 'window' } : null)
    })
    picker.on('closed', () => finish(null))
    picker.once('ready-to-show', () => picker.show())
    void picker.loadFile(path.join(__dirname, '..', 'picker', 'picker.html'))
  })
}
