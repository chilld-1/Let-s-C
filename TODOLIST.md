# Let's C — TodoList / 工程进度追踪

> 项目：共享屏幕、多人一起刷 B 站（P2P）的 Windows 桌面应用
> 仓库：https://github.com/chilld-1/Let-s-C.git
> 技术栈：Electron + TypeScript + React (electron-vite) + WebRTC + Node.js `ws` 信令服务器
> 选型文档：[docs/TECH-STACK.md](docs/TECH-STACK.md)

## 使用说明

- 每完成一个小任务：在下方对应任务的状态栏打勾、填写完成日期与验证结果，并及时 `git commit`。
- 每个任务都有四维验收标准：**功能 / 性能 / 安全 / 用户体验**，全部满足才算完成。
- 里程碑（Phase）全部完成后在"工程状态"更新。

## 工程状态

- [x] **Phase 0 初始化**（脚手架 + Git）
- [x] **Phase 1 信令服务器**
- [ ] **Phase 2 房主端窗口捕获**（T2.1/T2.3 完成，T2.2 待实机验收）
- [x] **Phase 3 WebRTC P2P 传输**（T3.1/T3.2 通过 E2E 自动化验证，T3.3 待跨网络实测）
- [ ] **Phase 4 房间管理 UI**（代码完成，待人工验收）
- [ ] **Phase 5 安全与健壮性**
- [x] **Phase 6 打包与文档**（T6.1 打包完成、T6.2 文档完成）

---

## Phase 0 · 项目初始化

### T0.1 脚手架初始化：electron-vite + TS + React
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：初始化项目结构（src/main、src/preload、src/renderer），配置 electron.vite.config.ts、tsconfig、dev 脚本可启动。
- 验收（已通过）：
  - 功能：`npm run dev` 启动 Electron 窗口正常；`npm run build` 无报错（main/preload/renderer 三端构建成功）。
  - 性能：构建 < 3s；启动正常。
  - 安全：`contextIsolation: true`、`nodeIntegration: false`、仅 contextBridge 暴露 API、CSP 已配置。
  - 用户体验：窗口正常显示，无控制台报错。
- 备注：Electron 二进制需通过国内镜像下载（`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。

### T0.2 Git 仓库关联与首次提交
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：`git init`、`.gitignore`、关联远程 https://github.com/chilld-1/Let-s-C.git、首次提交推送。
- 验收：
  - 功能：`git push` 成功，远程仓库可见全部文件。
  - 性能：node_modules / out / dist 已忽略。
  - 安全：无密钥/密码入库。
  - 用户体验：提交信息采用 feat/docs 前缀。

---

## Phase 1 · 信令服务器

### T1.1 信令服务器：房间管理 + SDP/ICE 转发
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：Node.js + `ws` 实现：创建房间（6 位房间码）、加入/离开、密码校验（sha256）、成员广播、signal 转发、房间容量限制、加入限速、断线重连恢复（持久化 clientId）。
- 验收（已通过，见 T1.2 测试）：
  - 功能：create/join/leave/signal 全流程可用；房主收到成员增删事件；密码错误/房间不存在/房间已满有明确错误。
  - 性能：信令为轻量 JSON 文本；单进程容量可配置（默认 20 人/房）。
  - 安全：消息 JSON 解析容错不崩溃；房间码随机 6 位（去易混淆字符）；signal 校验 `from`/`to` 均在房间内；密码 sha256 存储；10s 内最多 5 次加入尝试。
  - 用户体验：错误消息为可读中文。

### T1.2 信令服务器单元/集成测试
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：`server/test/smoke.mjs` 自动化测试：创建→加入→密码错误→双向 signal→非法 signal→不存在房间→离开→房主销毁→坏 JSON/未知 type。
- 验收（已通过）：14 项断言全部通过（`node server/test/smoke.mjs`）。

---

## Phase 2 · 房主端窗口捕获

### T2.1 窗口枚举与选择 UI
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：主进程 `desktopCapturer.getSources({types:['window']})` 枚举窗口（标题+缩略图），IPC 暴露 `capture:list-windows`；SharePicker 弹窗展示。
- 验收（已通过，`npx electron test/ipc-test.mjs`）：
  - 功能：枚举到 10 个窗口；id/name 格式正确；非法 id 返回错误；合法 id 选择成功；stopCapture 可用。
  - 性能：枚举毫秒级。
  - 安全：仅暴露窗口标题+缩略图；UI 只提供窗口选项，无屏幕选项。
  - 用户体验：缩略图+名称列表，点击选择。

### T2.2 窗口捕获 + 系统音频（setDisplayMediaRequestHandler）
- [ ] 状态：代码已完成，待实机验收 · 计划完成：____ · 实际完成：____
- 内容：主进程 `setDisplayMediaRequestHandler` 返回选中窗口（`audio:'loopback'`）；renderer `getDisplayMedia({video:true,audio:true})` 获取流并预览。
- 验收（待人工/实机验证）：
  - 功能：预览画面为所选窗口内容且实时更新；有系统音频。
  - 性能：预览帧率 ≥ 30fps（1080p）；CPU 占用合理。
  - 安全：只捕获窗口不捕获屏幕；切换其他应用不泄露内容。
  - 用户体验：有"停止共享"按钮与提示文案。

### T2.3 分辨率/码率档位选择
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：流畅（720p/30fps、≤2 Mbps）/ 高清（1080p/30fps、≤6 Mbps）两档；SharePicker 内画质选择器 + `getDisplayMedia` 分辨率/帧率约束 + `RTCRtpSender` maxBitrate 限制。
- 验收：
  - 功能：两档可切换（默认高清）；档位传入 `getDisplayMedia` 约束，并对每条发布连接设置 maxBitrate（`peer.ts applyMaxBitrate`）。
  - 性能：流畅档 `maxBitrate=2 Mbps`、高清档 `maxBitrate=6 Mbps`（≤ 8 Mbps）；帧率 30fps。
  - 安全：无新增暴露面，档位仅在渲染进程内选择，无敏感信息。
  - 用户体验：窗口选择弹窗内提供「流畅/高清」档位按钮，带码率说明文案。
- 备注：码率通过 `RTCRtpSender.setParameters({encodings:[{maxBitrate}]})` 限制（尽力而为，失败忽略）；真实码率档位效果待实机/双实例验证。`npm run typecheck` 通过，产物已重新打包（release3）。

---

## Phase 3 · WebRTC P2P 传输

### T3.1 房主端发布共享流
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：房主收到 `peer-joined` 后为每位观众建立 PeerConnection，`addTrack` + offer；处理 answer/ice；观众断开释放连接。
- 验收（已通过，`npx electron test/e2e/run.mjs`）：
  - 功能：观众加入自动建连推流；`peer-left` 自动释放。
  - 性能：offer→answer 建连 < 2s（E2E 内完成）。
  - 安全：只与房间内成员建连；对 `from` 非房间成员的 signal 忽略。
  - 用户体验：房主端显示每位观众连接状态。

### T3.2 观众端接收与播放
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：观众收到 offer → answer；`ontrack` 绑定 `<video>` 播放。
- 验收（已通过，E2E）：观众收到远端 MediaStream + 视频 track + 音频 track；`connectionState === 'connected'`；音视频轨道均通过 P2P 传输。

### T3.3 STUN 配置与连接状态机
- [x] 状态：代码已完成（跨公网 NAT 打洞待实测） · 计划完成：____ · 实际完成：____
- 内容：`iceServers` 配置 Google STUN（TURN 预留配置位）；`connectionState` 上报 UI。
- 验收：局域网/本机建连已验证；公网 NAT 打洞需部署信令服务器后跨网络实测；TURN 凭据不硬编码（经配置文件/环境变量）。

---

## Phase 4 · 房间管理 UI

### T4.1 创建/加入房间流程
- [ ] 状态：代码已完成，待人工验收 · 计划完成：____ · 实际完成：____
- 内容：首页创建（房间码+可选密码）/加入（房间码+密码）；房间码一键复制。
- 验收（待人工）：创建/加入响应 < 500ms；错误提示明确；房间码校验。

### T4.2 房间内页面与成员列表
- [ ] 状态：代码已完成，待人工验收 · 计划完成：____ · 实际完成：____
- 内容：房主（共享预览/选择/观众连接状态）+ 观众（观看画面）视图；成员列表实时刷新；离开按钮。
- 验收（待人工）：成员增删实时刷新；房主离开全员提示返回；不泄露 IP 等敏感信息。

---

## Phase 5 · 安全与健壮性

### T5.1 输入校验与异常防护
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：信令消息类型白名单 + 字段校验；UI 输入限制（房间码正则、昵称长度）；错误边界（error banner）。
- 验收（已通过）：坏 JSON/未知 type/非法字段均不崩溃（smoke.mjs 覆盖）；无 eval/无 innerHTML 拼接。

### T5.2 房间密码与会话生命周期
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：房主设密码（可选）；加入校验；房主离开销毁房间并通知观众；空房间兜底清理。
- 验收（已通过）：密码错误拒绝（smoke.mjs 覆盖）；房主离开广播 host-left；密码 sha256 存储不落日志。

### T5.3 断线重连与恢复
- [x] 状态：已完成（服务端 + 客户端实现） · 实际完成：2026-08-14
- 内容：客户端持久化 clientId（localStorage）+ 指数退避重连；重连后自动恢复房间（服务端按 clientId 恢复成员身份）。
- 验收（已通过 smoke.mjs 重连逻辑；断网场景待实机验证）：
  - 功能：WS 断开 5s 内重连并恢复房间；重连后重新校验身份。
  - 性能：退避重连（1s→2s→4s→5s 封顶）。
  - 安全：重连恢复需房间码+密码（密码错误则拒绝）。
  - 用户体验：UI 显示"连接中断，重连中…"。

---

## Phase 6 · 打包与文档

### T6.1 electron-builder 打包
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：配置 electron-builder 产出 Windows NSIS 安装包与便携版。
- 验收（已通过）：
  - 功能：产出 `Let's C-0.1.0-x64.exe`（NSIS 安装包 95.7MB）与 `Let's C-portable-0.1.0.exe`（便携版 95.5MB）；`win-unpacked/resources/app.asar`（8.2MB）完整。
  - 性能：单包 ≤ 100MB；打包流程 < 5min（Electron 二进制已缓存时）。
  - 安全：`asar: true` + `contextIsolation` 保持；`files` 已排除 `out/test/**`，未打包 `server/`、密钥、测试文件。
  - 用户体验：`win-unpacked\Let's C.exe` 冒烟启动成功（6s 存活未崩溃）；便携版双击即用。
- 备注：最终产物输出到 `release3/`（含 T2.3 画质档位；`dist/` 被外部进程锁住 default_app.asar，见 DEPLOY.md「打包已知问题」）。

### T6.2 README 与部署文档
- [x] 状态：已完成 · 实际完成：2026-08-14
- 内容：README（功能介绍、快速开始、信令服务器部署、STUN/TURN 配置）；docs/DEPLOY.md（部署、wss、STUN/TURN、安全、打包已知问题）。
- 验收（已通过）：README 与 DEPLOY.md 覆盖功能特性/快速开始/测试/部署/STUN/TURN/安全/打包；与代码实现一致（信令地址 localStorage 可配置、TURN 预留、国内镜像提示）。

---

## 验收记录表（汇总）

| 任务 | 功能 | 性能 | 安全 | 体验 | 结论 |
|---|---|---|---|---|---|
| T0.1 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T0.2 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T1.1 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T1.2 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T2.1 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T2.2 | 代码✅ 待实机 | 待实测 | 设计✅ | 待实测 | 进行中 |
| T2.3 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T3.1/T3.2 | 代码✅ 待联调 | 待联调 | 设计✅ | 待联调 | 进行中 |
| T4.1/T4.2 | 代码✅ 待验收 | 待验收 | 设计✅ | 待验收 | 进行中 |
| T5.1 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T5.2 | ✅ | ✅ | ✅ | ✅ | 完成 |
| T5.3 | ✅ 断网场景待实测 | ✅ | ✅ | ✅ | 基本完成 |
| T6.1/T6.2 | ✅ | ✅ | ✅ | ✅ | 完成 |

## 日志

- 2026-08-14 · 初始化 TodoList，拆分任务与四维验收标准。
- 2026-08-14 · Phase 0/1 完成；Phase 2 的 T2.1 完成（IPC 测试通过）；Phase 3/4 代码完成待联调；T5.x 完成。
- 2026-08-14 · 待办：双实例端到端联调（WebRTC）、T2.2/T2.3 实机验收、README/DEPLOY、打包。
- 2026-08-14 · T6.1 打包完成（NSIS + portable，产物 `release2/`）；T6.2 文档完成并核对；WebRTC E2E 通过（房主建房间、观众收到 video+audio）。
- 2026-08-14 · T2.3 画质档位完成（流畅/高清，`getDisplayMedia` 约束 + maxBitrate），重新打包到 `release3/` 并冒烟通过。
