/**
 * Let's C — 信令服务器
 *
 * 职责（媒体不经服务器转发，只转发信令）：
 *  - 房间创建 / 加入 / 离开 / 销毁
 *  - 成员列表广播
 *  - SDP / ICE 在房主与观众之间互转
 *  - 断线重连恢复（客户端持久化 clientId）
 *  - 输入校验、密码校验（sha256）、加入限速
 *
 * 用法：
 *   npm install && npm start          # 默认端口 8787
 *   PORT=9000 npm start               # 自定义端口
 */
import { WebSocketServer, WebSocket } from 'ws'
import { createHash, randomBytes } from 'crypto'

const PORT = Number(process.env.PORT) || 8787
const ROOM_CAPACITY = Number(process.env.ROOM_CAPACITY) || 20
const ROOM_CODE_LENGTH = 6
// 去掉易混淆字符（0/O、1/I/L）
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
// 同一连接 10s 内最多 5 次加入尝试（防暴力枚举房间码/密码）
const JOIN_RATE_LIMIT = { windowMs: 10_000, max: 5 }
const CLIENT_ID_RE = /^[0-9a-f]{16}$/

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} code
 * @property {string|null} passwordHash
 * @property {string} hostId
 * @property {number} createdAt
 * @property {Map<string, {id:string; name:string; role:'host'|'guest'; ws:WebSocket}>} members
 */

/** @type {Map<string, Room>} */
const rooms = new Map()
/** @type {WeakMap<WebSocket, {clientId:string; name:string; roomId:string|null; joinAttempts:number[]}>} */
const wsMeta = new WeakMap()

function genCode() {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}
function genId() {
  return randomBytes(8).toString('hex')
}
function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex')
}
function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
function broadcast(room, msg, exceptWs) {
  for (const m of room.members.values()) {
    if (m.ws !== exceptWs) send(m.ws, msg)
  }
}
function sanitizeName(name) {
  if (typeof name !== 'string') return ''
  return name.replace(/[\u0000-\u001f<>]/g, '').slice(0, 20).trim()
}
function normalizeClientId(v) {
  return typeof v === 'string' && CLIENT_ID_RE.test(v) ? v : null
}
function membersPayload(room) {
  return [...room.members.values()].map((m) => ({ id: m.id, name: m.name, role: m.role }))
}

const wss = new WebSocketServer({ port: PORT })
console.log(`[Let's C] 信令服务器已启动 ws://0.0.0.0:${PORT}（房间容量 ${ROOM_CAPACITY}）`)

wss.on('connection', (ws) => {
  wsMeta.set(ws, { clientId: genId(), name: '', roomId: null, joinAttempts: [] })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return send(ws, { type: 'error', message: '消息格式错误：不是合法的 JSON' })
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return send(ws, { type: 'error', message: '消息缺少 type 字段' })
    }
    try {
      handle(ws, msg)
    } catch (err) {
      console.error('[Let\'s C] 处理消息异常:', err)
      send(ws, { type: 'error', message: '服务器内部错误' })
    }
  })

  ws.on('close', () => leaveRoom(ws))
  ws.on('error', () => leaveRoom(ws))
})

function handle(ws, msg) {
  switch (msg.type) {
    case 'create-room':
      return createRoom(ws, msg)
    case 'join-room':
      return joinRoom(ws, msg)
    case 'leave-room':
      return leaveRoom(ws)
    case 'signal':
      return relaySignal(ws, msg)
    case 'heartbeat':
      return send(ws, { type: 'heartbeat-ack' })
    default:
      return send(ws, { type: 'error', message: `未知消息类型: ${msg.type}` })
  }
}

function createRoom(ws, msg) {
  leaveRoom(ws)
  const meta = wsMeta.get(ws)
  if (!meta) return

  const clientId = normalizeClientId(msg.clientId) || genId()
  const name = sanitizeName(msg.name) || '房主'
  meta.clientId = clientId
  meta.name = name

  // 断线重连：该 clientId 已是某个房间的房主 → 恢复原房间
  for (const room of rooms.values()) {
    const existing = room.members.get(clientId)
    if (room.hostId === clientId && existing) {
      existing.ws = ws
      existing.name = name
      meta.roomId = room.code
      broadcast(room, { type: 'members', members: membersPayload(room) }, ws)
      send(ws, { type: 'room-created', roomId: room.code, role: 'host', memberId: clientId })
      console.log(`[Let's C] 房主 ${clientId.slice(0, 6)} 重连房间 ${room.code}`)
      return
    }
  }

  let code = genCode()
  let guard = 0
  while ([...rooms.values()].some((r) => r.code === code) && guard++ < 100) {
    code = genCode()
  }
  const passwordHash =
    typeof msg.password === 'string' && msg.password.length > 0 ? sha256(msg.password) : null
  const room = {
    id: genId(),
    code,
    passwordHash,
    hostId: clientId,
    createdAt: Date.now(),
    members: new Map()
  }
  rooms.set(code, room)
  room.members.set(clientId, { id: clientId, name, role: 'host', ws })
  meta.roomId = code

  send(ws, { type: 'room-created', roomId: code, role: 'host', memberId: clientId })
  console.log(`[Let's C] 房间 ${code} 已创建（房主 ${name}）`)
}

function joinRoom(ws, msg) {
  const meta = wsMeta.get(ws)
  if (!meta) return

  const clientId = normalizeClientId(msg.clientId) || genId()
  const name = sanitizeName(msg.name) || `观众-${clientId.slice(0, 4)}`

  const code = typeof msg.roomId === 'string' ? msg.roomId.trim().toUpperCase() : ''
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    return send(ws, { type: 'error', message: '房间码格式不正确（应为 6 位大写字母/数字）' })
  }

  const room = rooms.get(code)
  if (!room) return send(ws, { type: 'error', message: '房间不存在，请检查房间码' })

  // 断线重连：该 clientId 已是本房间成员 → 直接恢复
  const existing = room.members.get(clientId)
  if (existing) {
    meta.clientId = clientId
    meta.name = name
    existing.ws = ws
    existing.name = name
    meta.roomId = code
    broadcast(room, { type: 'members', members: membersPayload(room) }, ws)
    send(ws, {
      type: 'room-joined',
      roomId: code,
      role: existing.role,
      memberId: clientId,
      hostId: room.hostId,
      members: membersPayload(room)
    })
    // 通知房主重建连接（若该成员此前已断开）
    if (existing.role !== 'host') {
      const host = room.members.get(room.hostId)
      if (host && host.ws !== ws) {
        send(host.ws, { type: 'peer-joined', peerId: clientId, peerName: name })
      }
    }
    console.log(`[Let's C] 成员 ${name} 重连房间 ${code}`)
    return
  }

  // 限速：10s 内最多 5 次加入尝试
  const now = Date.now()
  meta.joinAttempts = (meta.joinAttempts || []).filter((t) => now - t < JOIN_RATE_LIMIT.windowMs)
  if (meta.joinAttempts.length >= JOIN_RATE_LIMIT.max) {
    return send(ws, { type: 'error', message: '尝试次数过多，请稍后再试' })
  }
  meta.joinAttempts.push(now)

  if (room.passwordHash) {
    const pwd = typeof msg.password === 'string' ? msg.password : ''
    if (sha256(pwd) !== room.passwordHash) {
      return send(ws, { type: 'error', message: '房间密码错误' })
    }
  }
  if (room.members.size >= ROOM_CAPACITY) {
    return send(ws, { type: 'error', message: `房间已满（上限 ${ROOM_CAPACITY} 人）` })
  }

  // 全部校验通过后才写回连接状态
  meta.clientId = clientId
  meta.name = name
  leaveRoom(ws)
  room.members.set(clientId, { id: clientId, name, role: 'guest', ws })
  meta.roomId = code

  send(ws, {
    type: 'room-joined',
    roomId: code,
    role: 'guest',
    memberId: clientId,
    hostId: room.hostId,
    members: membersPayload(room)
  })
  broadcast(room, { type: 'members', members: membersPayload(room) })
  // 通知房主：新观众加入（触发房主发起 WebRTC offer）
  const host = room.members.get(room.hostId)
  if (host && host.ws !== ws) {
    send(host.ws, { type: 'peer-joined', peerId: clientId, peerName: name })
  }
  console.log(`[Let's C] ${name} 加入房间 ${code}（${room.members.size} 人）`)
}

function leaveRoom(ws) {
  const meta = wsMeta.get(ws)
  if (!meta || !meta.roomId) return
  const code = meta.roomId
  const room = rooms.get(code)
  if (!room) {
    meta.roomId = null
    return
  }

  const member = room.members.get(meta.clientId)
  room.members.delete(meta.clientId)
  meta.roomId = null

  if (member?.role === 'host') {
    // 房主离开 → 销毁房间，通知所有观众
    rooms.delete(code)
    broadcast(room, { type: 'host-left', message: '房主已离开，房间已关闭' }, ws)
    console.log(`[Let's C] 房主离开，房间 ${code} 已销毁`)
    return
  }

  // 普通成员离开 → 通知房主释放连接
  const host = room.members.get(room.hostId)
  if (host) send(host.ws, { type: 'peer-left', peerId: meta.clientId })
  broadcast(room, { type: 'members', members: membersPayload(room) })
  if (room.members.size === 0) rooms.delete(code)
  console.log(`[Let's C] 成员离开房间 ${code}（剩余 ${room.members.size} 人）`)
}

function relaySignal(ws, msg) {
  const meta = wsMeta.get(ws)
  if (!meta?.roomId) return send(ws, { type: 'error', message: '你不在任何房间中' })
  const room = rooms.get(meta.roomId)
  if (!room) return
  const from = room.members.get(meta.clientId)
  if (!from) return
  const toId = typeof msg.to === 'string' ? msg.to : ''
  const to = room.members.get(toId)
  if (!to) return // 丢弃发给房间外/不存在的成员的消息
  if (msg.data === undefined || msg.data === null || typeof msg.data !== 'object') {
    return send(ws, { type: 'error', message: 'signal 缺少 data' })
  }
  send(to.ws, { type: 'signal', from: meta.clientId, data: msg.data })
}

// 兜底清理空房间
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.members.size === 0) rooms.delete(code)
  }
}, 60_000).unref()
