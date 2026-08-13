/**
 * WebRTC 封装：星型拓扑（房主为发布者，每位观众一条 PeerConnection）
 * 房主：createPublisherPeer 推流；观众：createSubscriberPeer 收流。
 */

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

export interface PeerCallbacks {
  onStateChange?: (state: RTCPeerConnectionState) => void
}

/** 画质档位（T2.3）：流畅（≤2 Mbps）/ 高清（≤6 Mbps） */
export type QualityTier = 'smooth' | 'hd'

export interface QualityProfile {
  label: string
  hint: string
  maxBitrate: number
  width: number
  height: number
  frameRate: number
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  smooth: { label: '流畅', hint: '720p · ≤2 Mbps', maxBitrate: 2_000_000, width: 1280, height: 720, frameRate: 30 },
  hd: { label: '高清', hint: '1080p · ≤6 Mbps', maxBitrate: 6_000_000, width: 1920, height: 1080, frameRate: 30 }
}

export const DEFAULT_QUALITY: QualityTier = 'hd'

/** 把码率上限应用到某条 video 发送轨（尽力而为，失败时忽略） */
async function applyMaxBitrate(sender: RTCRtpSender, maxBitrate: number): Promise<void> {
  try {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    for (const enc of params.encodings) {
      enc.maxBitrate = maxBitrate
    }
    await sender.setParameters(params)
  } catch {
    // 某些浏览器/协商阶段不允许 setParameters，码率档位为尽力而为
  }
}

/** 房主端：为一位观众创建发布连接，立即发起 offer */
export async function createPublisherPeer(
  stream: MediaStream,
  sendSignal: (data: unknown) => void,
  callbacks?: PeerCallbacks,
  maxBitrate?: number
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  for (const track of stream.getTracks()) {
    const sender = pc.addTrack(track, stream)
    if (track.kind === 'video' && maxBitrate) {
      await applyMaxBitrate(sender, maxBitrate)
    }
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ ice: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => callbacks?.onStateChange?.(pc.connectionState)

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  sendSignal({ sdp: pc.localDescription })
  return pc
}

/** 观众端：创建接收连接，等待房主的 offer */
export async function createSubscriberPeer(
  sendSignal: (data: unknown) => void,
  onStream: (stream: MediaStream) => void,
  callbacks?: PeerCallbacks
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  pc.ontrack = (e) => {
    if (e.streams[0]) onStream(e.streams[0])
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ ice: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => callbacks?.onStateChange?.(pc.connectionState)
  return pc
}

/**
 * 处理收到的信令（SDP / ICE）。
 * - 收到 offer：返回 answer（由调用方回传）
 * - 收到 answer / ice：直接应用
 */
export async function handleSignal(
  pc: RTCPeerConnection,
  data: unknown
): Promise<RTCSessionDescriptionInit | undefined> {
  const d = data as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }
  if (d.sdp) {
    const desc = d.sdp
    await pc.setRemoteDescription(desc)
    if (desc.type === 'offer') {
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      return answer
    }
  }
  if (d.ice) {
    try {
      await pc.addIceCandidate(d.ice)
    } catch {
      // 忽略已过期/重复的候选
    }
  }
  return undefined
}

export function closePeer(pc: RTCPeerConnection | null | undefined): void {
  if (!pc) return
  try {
    pc.getSenders().forEach((s) => s.track?.stop())
    pc.close()
  } catch {
    // 已关闭则忽略
  }
}
