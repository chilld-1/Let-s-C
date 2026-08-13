/**
 * WebRTC E2E 集成测试驱动（对应 TODOLIST T3.1/T3.2）
 * 前提：信令服务器已启动（ws://localhost:8787）
 * 步骤：构建测试入口 → 运行本脚本：
 *   npx vite build --config test/e2e/vite.config.ts
 *   npx electron test/e2e/run.mjs
 */
import { app, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 运行时在 out/test 下生成 html（与 e2e.js 同级）
const HTML = join(__dirname, '../../out/test/e2e.html')
mkdirSync(dirname(HTML), { recursive: true })
writeFileSync(
  HTML,
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/></head><body><script src="./e2e.js"></script></body></html>'
)
const PAGE = 'file://' + HTML.replace(/\\/g, '/')
const SERVER = 'ws://localhost:8787'

let failed = 0
function ok(cond, name) {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`)
  if (!cond) failed++
}
function finish(code) {
  console.log(failed === 0 ? '\nWebRTC E2E 测试全部通过' : `\n${failed} 项失败`)
  app.exit(code)
}
setTimeout(() => finish(1), 60_000)

app.whenReady().then(async () => {
  const hostWin = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  const guestWin = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  // 转发 renderer 控制台日志便于诊断
  for (const w of [hostWin, guestWin]) {
    w.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`  [renderer] ${message}`)
    })
  }

  try {
    await hostWin.loadURL(PAGE)
    await guestWin.loadURL(PAGE)

    console.log('— 1. 房主创建房间 —')
    const host = await hostWin.webContents.executeJavaScript(
      `window.__e2e.startHost(${JSON.stringify(SERVER)})`
    )
    ok(
      typeof host.roomId === 'string' && /^[A-Z2-9]{6}$/.test(host.roomId),
      `房主创建房间成功：${host.roomId}`
    )

    console.log('— 2. 观众加入并接收流 —')
    const guest = await guestWin.webContents.executeJavaScript(
      `window.__e2e.startGuest(${JSON.stringify(SERVER)}, ${JSON.stringify(host.roomId)})`
    )
    ok(guest.gotStream, '观众收到远端 MediaStream')
    ok(guest.gotVideoTrack, '收到视频 track（共享画面）')
    ok(guest.gotAudioTrack, '收到音频 track（系统音频通道）')
    ok(guest.connState === 'connected', `PeerConnection 状态为 connected（实际 ${guest.connState}）`)

    console.log('— 3. 结论 —')
    ok(guest.connState === 'connected', '房主→观众 P2P 媒体链路完整建立（信令 + WebRTC 全链路）')
  } catch (err) {
    console.error('测试异常：', err?.message ?? err)
    failed++
  } finally {
    hostWin.destroy()
    guestWin.destroy()
    finish(failed === 0 ? 0 : 1)
  }
})
