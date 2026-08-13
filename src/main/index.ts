import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null

// 窗口源缓存：id -> DesktopCapturerSource（setDisplayMediaRequestHandler 回调需要源对象）
const windowSources = new Map<string, Electron.DesktopCapturerSource>()
let selectedSourceId: string | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "Let's C — 一起刷 B 站",
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 外链一律交给系统浏览器，不允许在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  /**
   * 捕获授权：仅把"用户明确选中的那个窗口"交给 renderer，
   * 配合系统音频 loopback（Windows WASAPI）。
   * 注意：保持 useSystemPicker 默认关闭 —— 系统选择器会绕过本 handler，
   * 用户可能选到整个屏幕，破坏"只共享本应用窗口"的约束。
   */
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const source = selectedSourceId ? windowSources.get(selectedSourceId) : undefined
    if (source) {
      callback({ video: source, audio: 'loopback' })
    } else {
      // 未选中任何窗口：拒绝请求（renderer 会收到 NotAllowedError）
      callback({})
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---- IPC：窗口枚举（只枚举"窗口"，绝不含屏幕） ----
ipcMain.handle('capture:list-windows', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })
  windowSources.clear()
  const list = sources.map((s) => {
    windowSources.set(s.id, s)
    return {
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL()
    }
  })
  return list
})

// ---- IPC：选择要共享的窗口 ----
ipcMain.handle('capture:select-window', (_e, id: unknown) => {
  if (typeof id !== 'string' || !windowSources.has(id)) {
    return { ok: false, error: '窗口不存在或已关闭，请刷新列表' }
  }
  selectedSourceId = id
  return { ok: true }
})

// ---- IPC：停止共享 ----
ipcMain.handle('capture:stop', () => {
  selectedSourceId = null
  return { ok: true }
})
