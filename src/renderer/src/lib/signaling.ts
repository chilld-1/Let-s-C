/**
 * 信令客户端（renderer 内 WebSocket 直连信令服务器）
 * 只交换控制消息与 SDP/ICE，媒体流走 WebRTC P2P。
 */

export interface Member {
  id: string
  name: string
  role: 'host' | 'guest'
}

export interface SignalingEvents {
  'room-created': { roomId: string; role: 'host'; memberId: string }
  'room-joined': { roomId: string; role: 'guest'; memberId: string; hostId: string; members: Member[] }
  members: { members: Member[] }
  'peer-joined': { peerId: string; peerName: string }
  'peer-left': { peerId: string }
  signal: { from: string; data: unknown }
  'host-left': { message: string }
  error: { message: string }
  'connection-state': { state: 'connected' | 'disconnected' | 'reconnecting' }
}

type EventName = keyof SignalingEvents
type Handler = (data: unknown) => void

export class SignalingClient {
  private ws: WebSocket | null = null
  private listeners = new Map<EventName, Set<Handler>>()
  private pending: Record<string, unknown>[] = []
  private reconnectAttempts = 0
  private manualClose = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly serverUrl: string) {}

  connect(): void {
    this.manualClose = false
    this.open()
  }

  private open(): void {
    try {
      this.ws = new WebSocket(this.serverUrl)
    } catch {
      this.emit('connection-state', { state: 'disconnected' })
      return
    }
    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.emit('connection-state', { state: 'connected' })
      // flush 连接建立前入队的消息（如 create-room / join-room）
      const q = this.pending
      this.pending = []
      for (const m of q) this.send(m)
    }
    this.ws.onmessage = (ev) => {
      let msg: { type: EventName } & Record<string, unknown>
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (msg && typeof msg.type === 'string') {
        this.emit(msg.type, msg as never)
      }
    }
    this.ws.onclose = () => {
      // 断线后丢弃未发送消息；房间上下文由上层（connection-state handler）负责恢复
      this.pending = []
      this.emit('connection-state', { state: 'disconnected' })
      if (!this.manualClose) this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 5000)
    this.reconnectAttempts += 1
    this.emit('connection-state', { state: 'reconnecting' })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  on<K extends EventName>(type: K, handler: (data: SignalingEvents[K]) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(handler as Handler)
    return () => this.listeners.get(type)?.delete(handler as Handler)
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      // 未连接时入队，连接建立后统一发送
      this.pending.push(msg)
    }
  }

  createRoom(opts: { password?: string; clientId: string; name: string }): void {
    this.send({
      type: 'create-room',
      password: opts.password || '',
      clientId: opts.clientId,
      name: opts.name
    })
  }

  joinRoom(opts: { roomId: string; password?: string; clientId: string; name: string }): void {
    this.send({
      type: 'join-room',
      roomId: opts.roomId,
      password: opts.password || '',
      clientId: opts.clientId,
      name: opts.name
    })
  }

  leaveRoom(): void {
    this.send({ type: 'leave-room' })
  }

  signal(to: string, data: unknown): void {
    this.send({ type: 'signal', to, data })
  }

  close(): void {
    this.manualClose = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  private emit<K extends EventName>(type: K, data: SignalingEvents[K]): void {
    this.listeners.get(type)?.forEach((h) => h(data))
  }
}
