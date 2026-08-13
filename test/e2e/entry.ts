/**
 * E2E 测试入口（对应 TODOLIST T3.1/T3.2 验收）
 * 用 canvas.captureStream 模拟共享源，验证：真实信令服务器 + 真实 WebRTC P2P 链路。
 * 由 test/e2e/run.mjs 驱动（两个隐藏窗口分别扮演房主/观众）。
 */
import { SignalingClient } from '../../src/renderer/src/lib/signaling'
import {
  closePeer,
  createPublisherPeer,
  createSubscriberPeer,
  handleSignal
} from '../../src/renderer/src/lib/peer'

const genId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)

interface HostHandle {
  roomId: string
}
interface GuestResult {
  gotStream: boolean
  gotVideoTrack: boolean
  gotAudioTrack: boolean
  connState: string
}

async function startHost(serverUrl: string, name = 'e2e-host'): Promise<HostHandle> {
  const sig = new SignalingClient(serverUrl)
  const peers = new Map<string, RTCPeerConnection>()

  // 模拟共享源：动态画布
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')!
  let frame = 0
  const draw = () => {
    ctx.fillStyle = `hsl(${(frame * 4) % 360}, 80%, 50%)`
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = '#fff'
    ctx.font = '42px sans-serif'
    ctx.fillText(`Lets-C frame ${frame}`, 40, 90)
    frame++
  }
  draw()
  const stream = canvas.captureStream(30)
  // 补充音频轨道（模拟系统音频通道），验证音频也能通过 WebRTC 传输
  const actx = new AudioContext()
  const osc = actx.createOscillator()
  const dest = actx.createMediaStreamDestination()
  osc.connect(dest)
  osc.frequency.value = 440
  osc.start()
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
  const tick = setInterval(draw, 33)

  return await new Promise<HostHandle>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('E2E 超时：房主未创建房间')), 10_000)
    sig.on('error', ({ message }) => reject(new Error(message)))
    sig.on('room-created', ({ roomId }) => {
      clearTimeout(timer)
      resolve({ roomId })
    })
    sig.on('peer-joined', ({ peerId }) => {
      void createPublisherPeer(
        stream,
        (d) => sig.signal(peerId, d)
      ).then((pc) => peers.set(peerId, pc))
    })
    sig.on('signal', async ({ from, data }) => {
      const pc = peers.get(from)
      if (pc) await handleSignal(pc, data)
    })
    sig.on('peer-left', ({ peerId }) => {
      closePeer(peers.get(peerId))
      peers.delete(peerId)
    })
    sig.connect()
    sig.createRoom({ password: '', clientId: genId(), name })
  })

  function disposeHost(): void {
    clearInterval(tick)
    stream.getTracks().forEach((t) => t.stop())
    for (const [, pc] of peers) closePeer(pc)
    peers.clear()
    sig.close()
  }
}

async function startGuest(serverUrl: string, roomId: string, name = 'e2e-guest'): Promise<GuestResult> {
  const sig = new SignalingClient(serverUrl)
  const peers = new Map<string, RTCPeerConnection>()
  let hostId = ''
  let remoteStream: MediaStream | null = null
  let connState = 'new'
  let resolved = false

  return await new Promise<GuestResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('E2E 超时：观众未收到视频流')), 20_000)
    sig.on('error', ({ message }) => reject(new Error(message)))
    sig.on('room-joined', ({ hostId: hid }) => {
      hostId = hid
    })
    sig.on('signal', async ({ from, data }) => {
      if (from !== hostId) return
      let pc = peers.get(from)
      if (!pc) {
        pc = await createSubscriberPeer(
          (d) => sig.signal(from, d),
          (s) => {
            remoteStream = s
            check()
          },
          { onStateChange: (st) => { connState = st; check() } }
        )
        peers.set(from, pc)
      }
      const answer = await handleSignal(pc, data)
      if (answer) sig.signal(from, { sdp: answer })
    })
    sig.connect()
    sig.joinRoom({ roomId, password: '', clientId: genId(), name })

    function check(): void {
      if (resolved || !remoteStream || connState !== 'connected') return
      const videoTrack = remoteStream!.getVideoTracks()[0]
      const audioTrack = remoteStream!.getAudioTracks()[0]
      if (!videoTrack) return // 视频 track 未就绪则继续等
      // 再等一帧渲染周期，确认媒体实际流动
      const video = document.createElement('video')
      video.srcObject = remoteStream
      void video.play().then(() => {
        setTimeout(() => {
          resolved = true
          clearTimeout(timer)
          sig.close()
          for (const [, pc] of peers) closePeer(pc)
          peers.clear()
          resolve({ gotStream: true, gotVideoTrack: !!videoTrack, gotAudioTrack: !!audioTrack, connState })
        }, 600)
      })
    }
  })
}

declare global {
  interface Window {
    __e2e?: { startHost: typeof startHost; startGuest: typeof startGuest }
  }
}

window.__e2e = { startHost, startGuest }
export {}
