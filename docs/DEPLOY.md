# Let's C — 信令服务器部署与 STUN/TURN 配置

## 1. 部署信令服务器

信令服务器只负责：房间管理、密码校验、SDP/ICE 转发。**视频与声音始终 P2P 直连，不经过它**，因此带宽要求极低（仅信令文本，每秒几 KB），任意低配云主机即可。

### 1.1 本地运行

```bash
cd server
npm install
npm start                 # ws://0.0.0.0:8787
```

### 1.2 云服务器（Linux）

```bash
# 上传 server/ 目录，或直接 git clone 后只保留 server/
cd server
npm install --omit=dev
# 用 nohup / systemd / pm2 常驻：
nohup node src/index.js > server.log 2>&1 &
```

systemd 单元示例（`/etc/systemd/system/lets-c-signaling.service`）：

```ini
[Unit]
Description=Let's C signaling server
After=network.target

[Service]
WorkingDirectory=/opt/lets-c/server
ExecStart=/usr/bin/node src/index.js
Restart=always
Environment=PORT=8787
Environment=ROOM_CAPACITY=20

[Install]
WantedBy=multi-user.target
```

### 1.3 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 监听端口 |
| `ROOM_CAPACITY` | 20 | 单房间人数上限 |
| `SIGNAL_URL` | — | 客户端侧配置：`ws://服务器IP:8787` 或 `wss://域名` |

### 1.4 使用 HTTPS/WSS（推荐）

生产环境建议用 Nginx/Caddy 反代，将 `wss://` 转发到 `ws://127.0.0.1:8787`，避免明文信令被篡改。

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name letsc.example.com;
    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

## 2. 客户端配置信令服务器地址

应用首页 →「高级设置」→ 修改「信令服务器」为部署地址（如 `wss://letsc.example.com`），保存后创建/加入房间即可。地址保存在本地 `localStorage`。

## 3. STUN / TURN

### 3.1 STUN（默认已配置）

客户端内置 Google 公共 STUN：

```ts
// src/renderer/src/lib/peer.ts
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
```

大多数家庭/校园 NAT 可借此完成打洞，P2P 直连。

### 3.2 TURN（对称 NAT 兜底）

严格对称 NAT（部分企业网络/移动热点）下打洞会失败，此时必须 TURN 中继。TURN 流量会经过中继服务器（不再是纯 P2P），这是 WebRTC 的实际限制。

自建 coturn（Linux，约 5 分钟）：

```bash
sudo apt install coturn
# /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=letsc:强密码
realm=example.com
total-quota=100
```

然后在 `src/renderer/src/lib/peer.ts` 的 `ICE_SERVERS` 中追加（或改为从环境/配置文件读取，**不要把真实凭据提交到仓库**）：

```ts
{
  urls: 'turn:你的服务器:3478',
  username: 'letsc',
  credential: process.env.TURN_CREDENTIAL // 通过构建环境注入
}
```

> 安全提示：TURN 凭据不要硬编码在源码里；生产建议用 TURN REST API 临时凭据（`?turn=` 格式）。

## 4. 安全说明

- 密码仅以 sha256 存储，不落日志。
- 加入尝试限速（10s 内最多 5 次），防房间码/密码暴力枚举。
- 房间码为随机 6 位（去除易混淆字符），不可预测。
- 建议：敏感直播场景请使用 wss:// 部署 + 设置房间密码。
