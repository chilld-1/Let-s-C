import { contextBridge, ipcRenderer } from 'electron'

export interface WindowInfo {
  id: string
  name: string
  thumbnail: string | null
}

export interface CaptureApi {
  /** 枚举当前所有可见窗口（仅窗口，不含屏幕） */
  listWindows: () => Promise<WindowInfo[]>
  /** 选定要共享的窗口（此后 getDisplayMedia 只返回该窗口 + 系统音频） */
  selectWindow: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 停止共享（后续 getDisplayMedia 会被拒绝） */
  stopCapture: () => Promise<{ ok: boolean }>
}

const api: CaptureApi = {
  listWindows: () => ipcRenderer.invoke('capture:list-windows'),
  selectWindow: (id: string) => ipcRenderer.invoke('capture:select-window', id),
  stopCapture: () => ipcRenderer.invoke('capture:stop')
}

contextBridge.exposeInMainWorld('api', api)
