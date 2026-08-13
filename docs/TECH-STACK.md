# Let's C — 框架选型与技术方案

> 版本：v0.1 · 2025-xx-xx · 状态：已定稿，待实现

## 1. 产品定义

**Let's C**：一个 Windows 桌面应用，实现"共享屏幕、多人一起刷 B 站"。

- **房主**：共享自己正在观看的**指定应用窗口**（例如 Chrome/Edge 中的 B 站页面，或 B 站客户端窗口）。
- **观众**：通过房间码加入，实时观看房主共享的画面与声音（P2P 直连，不经过服务器转发媒体）。
- **核心约束**：观众**只能看到被共享的那个应用窗口**；房主切换到其他应用时，观众不会看到其他应用的内容（只捕获窗口本身，不捕获整个屏幕）。
- **多人**：一个房间内 1 名房主 + N 名观众同时观看。

## 2. 类似软件调研

| 软件 | 形态 | 媒体传输路径 | 与 Let's C 的对比 |
|---|---|---|---|
| Discord 屏幕共享 | 房间制、可共享窗口/屏幕 | WebRTC 协议栈 + **服务器转发**（媒体服务器） | 功能类似（共享指定窗口），但媒体走服务器，非 P2P |
| 腾讯会议 / 钉钉 | 会议制共享屏幕 | 自研媒体引擎（WebRTC 演进），**服务器转发（SFU）** | 共享屏幕，但为服务器中转架构，且共享整个屏幕 |
| Watch2Gether | 房间制一起看 YouTube | 各端**自己从 YouTube 拉流**，服务器（WebSocket）只同步播放控制 | 媒体不经服务器，但"各自拉流"；Let's C 是"共享房主画面" |
| Syncplay | 本地视频文件同步播放 | 各端本地播放，TCP 服务器只同步进度 | 同上，同步式而非画面共享式 |
| 网易云音乐"一起听" | 房间制 | 服务器统一分发 | 无画面共享 |
| B 站"一起看" | 房间制 | 复用直播链路，服务器协调，各端各自播放 | 各端拉流，非画面共享；Let's C 强调"看房主的画面" |

**结论**：商业产品的屏幕共享均走服务器转发（带宽可控、NAT 穿透简单），纯 P2P 的只有"各自拉流 + 同步"类。**"房主窗口画面共享 + 媒体 P2P 不经服务器"** 是 Let's C 的特色约束，通过 WebRTC 星型拓扑实现。

## 3. 技术选型

| 模块 | 选型 | 理由 |
|---|---|---|
| 客户端框架 | **Electron**（当前 stable，36+） | 跨平台桌面、内嵌 Chromium 提供 WebRTC 与 `getDisplayMedia`、`desktopCapturer` 可枚举/捕获指定窗口 |
| 语言 | **TypeScript** | 类型安全，信令协议与 WebRTC 代码复杂，利于维护 |
| 构建 | **electron-vite** + React | 官方推荐脚手架，主/预加载/渲染三进程一体化构建，热更新 |
| UI | **React** | 房间管理、成员列表、共享选择等交互较多 |
| 屏幕/窗口捕获 | `desktopCapturer.getSources({types:['window']})` + `session.setDisplayMediaRequestHandler` | 只枚举**窗口**（非屏幕），从源头保证"切换其他应用黑屏/不可见" |
| 系统音频 | 捕获回调中 `audio: 'loopback'` | Windows 走 WASAPI loopback 抓系统音频（含 B 站视频声音）；**不**使用已被移除的 `chromeMediaSource` 旧约束 |
| P2P | **WebRTC**（`RTCPeerConnection`） | 浏览器原生、NAT 打洞（ICE/STUN）、音视频传输成熟 |
| 拓扑 | **星型**：房主与每个观众各建一条 PeerConnection | 观众之间不互联；媒体 P2P 直连，信令服务器只转发 SDP/ICE |
| 信令服务器 | **Node.js + `ws`**（独立进程，可单独部署） | 轻量（百行级），房间管理 + 信令转发足够；不引入 socket.io 等重依赖 |
| NAT 穿透 | **STUN**（Google 公共）为主；**TURN 预留配置位**（coturn 自部署） | 对称 NAT 下 P2P 打洞失败必须 TURN 兜底，否则观众连不上 |
| 打包 | **electron-builder** | 产出 Windows 安装包 / 便携版 |

## 4. 架构

```
┌────────────────────────────────────────────────────┐
│               信令服务器 (Node.js + ws)              │
│   房间创建/加入/离开 · 成员列表广播 · SDP/ICE 转发     │
└───────────────▲─────────────────────▲──────────────┘
            WS  │                     │ WS
   ┌────────────┴─────────┐   ┌───────┴──────────┐
   │ 房主 (Electron 主进程) │   │ 观众 (Electron)    │
   │ · desktopCapturer     │   │ · renderer 收流    │
   │ · setDisplayMedia...  │   │ · <video> 播放     │
   │  Handler 授权捕获      │   │                   │
   └────────────┬─────────┘   └───────┬──────────┘
                │  renderer: WebRTC   │
                │  RTCPeerConnection  │
                └─────P2P 媒体直连─────┘
               （STUN 打洞，必要时 TURN 兜底）
```

**进程职责**：
- **主进程（main）**：窗口生命周期；`desktopCapturer` 枚举窗口；`setDisplayMediaRequestHandler` 将选中的窗口 + 系统音频交给渲染进程；IPC 暴露 `listWindows` / `selectWindow`。
- **预加载（preload）**：`contextBridge` 安全暴露 IPC API。
- **渲染进程（renderer）**：UI；`navigator.mediaDevices.getDisplayMedia()` 获取共享流；`RTCPeerConnection` 发布/接收；WebSocket 连接信令服务器。

## 5. 关键实现要点

### 5.1 只共享指定窗口（切换其他应用不可见）

- 只枚举 `types: ['window']`，绝不在 UI 中提供"共享屏幕"选项。
- 保持 `useSystemPicker: false`（默认），否则系统选择器可能让用户选到整个屏幕，破坏约束。
- 捕获的是窗口自身的表面（Windows Graphics Capture），而非屏幕合成画面 → 观众看不到房主的其他活动。
- 窗口被遮挡/最小化时的画面行为（冻结/黑屏）需实机验证；MVP 文档中说明限制。

### 5.2 系统音频

- renderer：`getDisplayMedia({ video: true, audio: true })`。
- 主进程回调：`callback({ video: 选中窗口, audio: 'loopback' })`（系统音频，Windows WASAPI loopback）。

### 5.3 信令协议（JSON over WebSocket）

```
C→S: { type:'create-room', password? }          → S→C: { type:'room-created', roomId, role:'host' }
C→S: { type:'join-room', roomId, password? }    → S→C: { type:'room-joined', role:'guest', members }
C→S: { type:'signal', to:<peerId>, data:{sdp|ice} }
S→C: { type:'signal', from:<peerId>, data }      // 房主↔观众互转
S→C: { type:'peer-joined'|'peer-left'|'members'|'error', ... }
```

### 5.4 WebRTC 连接流程（星型）

1. 房主收到 `peer-joined` → `new RTCPeerConnection()` → `addTrack(stream)` → `createOffer` → 发送 offer。
2. 观众收到 offer → 建 PeerConnection → `setRemoteDescription` → `createAnswer` → 返回。
3. 双方交换 ICE candidate，媒体 P2P 直连。
4. 房主上行带宽 = N × 码率（1080p 视频约 3–8 Mbps，5–10 人可行；可通过码率/分辨率/帧率控制调节）。

## 6. 风险与权衡

| 风险 | 影响 | 应对 |
|---|---|---|
| 对称 NAT / 严格 NAT 打洞失败 | 观众连不上 | 预留 TURN（coturn）配置位，必要时部署；文档说明 |
| 系统音频会混入其他应用声音 | 体验 | MVP 接受；后续可提示用户静音其他应用 |
| 窗口最小化/被遮挡时捕获画面冻结或黑屏 | 观众体验 | 实机验证行为，UI 提示房主保持窗口可见 |
| 房主上行带宽瓶颈 | 观众人数上限 | 提供分辨率/码率档位选择 |
| `audio:'loopback'` 在个别平台行为差异 | 无声 | Windows 为 MVP 目标平台（调研确认 WASAPI 正常），macOS 需权限键 |

## 7. 验收维度约定

每个任务按四维验收：
- **功能**：行为是否符合需求描述。
- **性能**：延迟、帧率、带宽、资源占用可接受。
- **安全**：输入校验、权限最小化、无注入/越权。
- **用户体验**：操作直观、状态清晰、错误可恢复。
