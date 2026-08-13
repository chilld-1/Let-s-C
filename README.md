# Let's C

共享屏幕 · 多人一起刷 B 站（P2P 直连）的 Windows 桌面应用。

房主共享自己正在观看的**指定应用窗口**（浏览器 / B 站客户端等），观众通过房间码实时观看房主画面与声音。**媒体流通过 WebRTC P2P 直连，不经过服务器**；观众只能看到被共享的那一个窗口，房主切换其他应用时观众不会看到其他内容。

## 功能特性

- 🖥️ **窗口级共享**：只共享你选中的窗口（非整屏），切换其他应用观众不可见
- 🔈 **声音同步**：捕获系统音频（Windows WASAPI loopback），B 站视频声音实时传递
- ⚡ **P2P 低延迟**：信令服务器仅交换连接信息，音视频媒体房主 ↔ 观众直连
- 🏠 **房间制**：6 位房间码 + 可选密码，创建/加入一键完成
- 👥 **实时成员列表**：进出提示、连接状态展示
- 🔄 **断线自动恢复**：网络闪断自动重连并恢复房间身份
- 🔒 **安全设计**：房间码+密码校验、加入限速、信令输入校验、contextIsolation + CSP

## 技术栈

| 层 | 技术 |
|---|---|
| 客户端 | Electron 43 + TypeScript + React 19（electron-vite 5） |
| 捕获 | `desktopCapturer` + `setDisplayMediaRequestHandler`（窗口级 + 系统音频 loopback） |
| P2P | WebRTC（RTCPeerConnection，星型拓扑：房主与每位观众各一条连接） |
| 信令 | Node.js + `ws`（独立进程，可远程部署） |
| NAT 穿透 | STUN（Google 公共）；TURN 预留配置位（见 docs/DEPLOY.md） |

架构与选型详见 [docs/TECH-STACK.md](docs/TECH-STACK.md)。

## 快速开始（本地开发）

```bash
# 1. 安装依赖（Electron 二进制若下载失败，可设置镜像后重装）
npm install
# 国内镜像：
#   $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
#   node node_modules/electron/install.js

# 2. 启动信令服务器（终端 A）
cd server
npm install
npm start            # 监听 ws://0.0.0.0:8787

# 3. 启动应用（终端 B）
npm run dev
```

**联调**：开两个应用实例（`npm run dev` 两次，或本机 + 另一台电脑）。实例 A 点「创建房间并共享」→ 选窗口；实例 B 输入房间码「加入房间」。

## 测试

```bash
# 信令服务器集成测试（需先启动服务器）
cd server && npm start
cd server && node test/smoke.mjs        # 14 项断言

# 主进程 IPC 链路测试
npm run build && npx electron test/ipc-test.mjs

# WebRTC P2P 端到端测试（需先启动信令服务器）
npx vite build --config test/e2e/vite.config.ts
npx electron test/e2e/run.mjs           # 双窗口真实信令 + 真实 WebRTC

# 类型检查
npm run typecheck
```

## 信令服务器部署

见 [docs/DEPLOY.md](docs/DEPLOY.md)（本地/云服务器部署、端口与环境变量、STUN/TURN 配置、安全说明）。

## 已知限制

- 系统音频为整个系统声音（WASAPI loopback），会包含其他应用的声音；建议房主静音无关应用。
- 共享的窗口被最小化时，观众端可能看到黑屏（Windows 窗口捕获限制），请保持窗口可见。
- 严格对称 NAT 下 P2P 打洞可能失败，需要 TURN 服务器兜底（部署说明见 DEPLOY.md）。
- 房主上行带宽 = 观众数 × 码率；1080p 约 3–8 Mbps/人，建议 5–10 名观众内使用。

## 工程进度

任务拆分、四维验收标准（功能 / 性能 / 安全 / 用户体验）与进度追踪见 [TODOLIST.md](TODOLIST.md)。

## 目录结构

```
├─ src/
│  ├─ main/            # Electron 主进程：窗口捕获、IPC、displayMedia 授权
│  ├─ preload/         # contextBridge 安全桥接
│  └─ renderer/        # React UI：首页 / 房间 / 窗口选择
├─ server/             # 信令服务器（独立 Node 服务）
│  ├─ src/index.js
│  └─ test/smoke.mjs
├─ test/               # IPC 链路测试、WebRTC E2E 测试
├─ docs/               # 选型文档、部署文档
└─ TODOLIST.md
```
