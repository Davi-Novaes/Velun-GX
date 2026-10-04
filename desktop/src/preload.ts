import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Ponte "window.velun": a página do sistema só detecta o app e usa estas funções. Nada de Node exposto.
const version = process.argv.find((arg) => arg.startsWith('--velun-version='))?.split('=')[1] ?? '0.0.0'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

contextBridge.exposeInMainWorld('velun', {
  app: 'Velun Gx',
  version,
  /** Tela de "sem conexão": tenta abrir o sistema de novo. */
  retry: () => ipcRenderer.send('velun:retry'),
  /** Fonte escolhida no seletor do app na última captura (tela ou janela). */
  selectedSource: () => ipcRenderer.invoke('velun:selected-source'),
  update: {
    /** Versão nova já baixada, ou null. */
    status: () => ipcRenderer.invoke('velun:update:status'),
    onReady: (callback: (update: { version: string; installing?: boolean }) => void) => subscribe('velun:update-ready', callback),
    /** A última instalação não concluiu (o app abriu na versão antiga), ou null. */
    failed: () => ipcRenderer.invoke('velun:update:failed'),
    /** Download em andamento (versão e %), ou null. */
    progress: () => ipcRenderer.invoke('velun:update:progress'),
    onProgress: (callback: (progress: { version: string; percent: number }) => void) => subscribe('velun:update-progress', callback),
    /** Fecha, instala e abre de novo. */
    install: () => ipcRenderer.invoke('velun:update:install'),
  },
  audio: {
    probe: () => ipcRenderer.invoke('velun:audio:probe'),
    start: (scope: 'shared' | 'system') => ipcRenderer.invoke('velun:audio:start', scope),
    stop: () => ipcRenderer.invoke('velun:audio:stop'),
    onData: (callback: (chunk: Uint8Array) => void) => subscribe('velun:audio:data', callback),
    onStatus: (callback: (status: unknown) => void) => subscribe('velun:audio:status', callback),
  },
})
