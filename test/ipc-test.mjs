/**
 * Electron IPC 链路集成测试（对应 TODOLIST T2.1 验收）
 * 验证：preload contextBridge → IPC → 主进程 desktopCapturer.getSources 全链路可用。
 * 运行：npx electron test/ipc-test.mjs （先执行 npm run build）
 */
import { app, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// 加载真实主进程（副作用：注册 capture:* IPC handler 与 displayMedia handler）
await import('../out/main/index.js')

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRELOAD = join(__dirname, '../out/preload/index.js')
const RENDERER = join(__dirname, '../out/renderer/index.html')

let failed = 0
function ok(cond, name) {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`)
  if (!cond) failed++
}
function finish(code) {
  console.log(failed === 0 ? '\nIPC 链路测试全部通过' : `\n${failed} 项失败`)
  app.exit(code)
}
// 兜底：60s 超时强制退出
setTimeout(() => finish(1), 60_000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await win.loadFile(RENDERER)

    // 1. preload API 已暴露
    const hasApi = await win.webContents.executeJavaScript(
      'typeof window.api === "object" && typeof window.api.listWindows === "function"'
    )
    ok(hasApi, 'preload contextBridge 暴露 window.api.listWindows')

    // 2. window.api.listWindows 全链路（IPC → desktopCapturer → 返回列表）
    const list = await win.webContents.executeJavaScript('window.api.listWindows()')
    ok(Array.isArray(list), 'listWindows 返回数组')
    ok(list.length > 0, `枚举到 ${list.length} 个窗口`)
    const first = list[0]
    ok(
      typeof first.id === 'string' && first.id.startsWith('window:'),
      `窗口 id 格式正确：${first.id.slice(0, 20)}…`
    )
    ok(typeof first.name === 'string' && first.name.length > 0, `窗口标题非空：${first.name}`)

    // 3. selectWindow 对非法 id 返回错误
    const bad = await win.webContents.executeJavaScript(
      'window.api.selectWindow("window:nonexistent:123")'
    )
    ok(bad.ok === false && typeof bad.error === 'string', '非法窗口 id 返回明确错误')

    // 4. selectWindow 对合法 id 成功
    const good = await win.webContents.executeJavaScript(
      `window.api.selectWindow(${JSON.stringify(first.id)})`
    )
    ok(good.ok === true, '合法窗口 id 选择成功')

    // 5. stopCapture 可用
    const stopped = await win.webContents.executeJavaScript('window.api.stopCapture()')
    ok(stopped.ok === true, 'stopCapture 返回成功')
  } catch (err) {
    console.error('测试异常：', err)
    failed++
  } finally {
    win.destroy()
    finish(failed === 0 ? 0 : 1)
  }
})
