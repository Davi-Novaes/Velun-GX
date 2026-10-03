import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('velunPicker', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  choose: (id: string | null) => ipcRenderer.send('picker:choose', id),
})
