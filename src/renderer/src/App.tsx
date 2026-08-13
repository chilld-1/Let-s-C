import { useCallback, useEffect, useRef, useState } from 'react'
import { SignalingClient, type Member } from './lib/signaling'
import {
  closePeer,
  createPublisherPeer,
  createSubscriberPeer,
  handleSignal
} from './lib/peer'
import { getClientId, getDefaultName, getServerUrl, saveName, saveServerUrl } from './lib/clientId'
import Home from './components/Home'
import Room from './components/Room'
import SharePicker from './components/SharePicker'

type Role = 'host' | 'guest'
type Phase = 'home' | 'room'
type WsState = 'idle' | 'connected' | 'disconnected' | 'reconnecting'

export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('home')
  const [role, setRole] = useState<Role | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [wsState, setWsState] = useState<WsState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState<string>(getServerUrl())

  // 房主共享状态
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [sharedName, setSharedName] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [hostPeerStates, setHostPeerStates] = useState<Record<string, string>>({})

  // 观众观看状态
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [guestConnState, setGuestConnState] = useState<string>('new')

  const signalingRef = useRef<SignalingClient | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const pendingPeersRef = useRef<Set<string>>(new Set())
  const roleRef = useRef<Role | null>(null)
  const phaseRef = useRef<Phase>('home')
  const hostIdRef = useRef<string | null>(null)
  const sessionRef = useRef<{ roomId: string; password: string } | null>(null)
  const nameRef = useRef<string>(getDefaultName())
  const serverUrlRef = useRef<string>(serverUrl)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    roleRef.current = role
  }, [role])
  useEffect(() => {
    serverUrlRef.current = serverUrl
    saveServerUrl(serverUrl)
  }, [serverUrl])

  const resetToHome = useCallback(() => {
    // 停止共享
    const stream = localStreamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
    }
    setSharedName(null)
    void window.api.stopCapture()
    // 关闭所有 peer
    for (const [, pc] of peersRef.current) closePeer(pc)
    peersRef.current.clear()
    pendingPeersRef.current.clear()
    setHostPeerStates({})
    // 观众状态
    setRemoteStream(null)
    setGuestConnState('new')
    // 房间状态
    setMembers([])
    setRoomId(null)
    setRole(null)
    hostIdRef.current = null
    sessionRef.current = null
    signalingRef.current?.close()
    signalingRef.current = null
    setPhase('home')
  }, [])

  const leaveRoom = useCallback(() => {
    signalingRef.current?.leaveRoom()
    resetToHome()
  }, [resetToHome])

  // ---------- 房主：共享 ----------
  const stopShare = useCallback(() => {
    for (const [, pc] of peersRef.current) closePeer(pc)
    peersRef.current.clear()
    setHostPeerStates({})
    const stream = localStreamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    setLocalStream(null)
    setSharedName(null)
    void window.api.stopCapture()
  }, [])

  const createHostPeer = useCallback(async (peerId: string) => {
    const sig = signalingRef.current
    const stream = localStreamRef.current
    if (!sig || !stream) {
      pendingPeersRef.current.add(peerId)
      return
    }
    // 重连场景：若该观众已有旧连接，先释放
    const old = peersRef.current.get(peerId)
    if (old) closePeer(old)
    const pc = await createPublisherPeer(
      stream,
      (data) => sig.signal(peerId, data),
      {
        onStateChange: (s) => setHostPeerStates((prev) => ({ ...prev, [peerId]: s }))
      }
    )
    peersRef.current.set(peerId, pc)
  }, [])

  const startShare = useCallback(
    async (windowId: string, windowName: string) => {
      const res = await window.api.selectWindow(windowId)
      if (!res.ok) {
        setError(res.error ?? '选择窗口失败')
        return false
      }
      let stream: MediaStream | null = null
      try {
        // 触发主进程 setDisplayMediaRequestHandler → 返回所选窗口 + 系统音频
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      } catch (err) {
        setError(`无法获取共享画面：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
      localStreamRef.current = stream
      setLocalStream(stream)
      setSharedName(windowName)
      setError(null)
      // 共享流结束（窗口关闭等）→ 自动停止共享
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopShare()
      })
      // 处理等待中的观众
      for (const pid of pendingPeersRef.current) {
        void createHostPeer(pid)
      }
      pendingPeersRef.current.clear()
      return true
    },
    [createHostPeer, stopShare]
  )

  // ---------- 信令事件 ----------
  const ensureSignaling = useCallback((): SignalingClient => {
    if (signalingRef.current) return signalingRef.current

    const sig = new SignalingClient(serverUrlRef.current)
    signalingRef.current = sig

    sig.on('connection-state', ({ state }) => {
      setWsState(
        state === 'connected' ? 'connected' : state === 'reconnecting' ? 'reconnecting' : 'disconnected'
      )
      // 断线自动重连后：恢复房间上下文
      if (state === 'connected' && phaseRef.current === 'room' && sessionRef.current) {
        if (roleRef.current === 'host') {
          sig.createRoom({ password: sessionRef.current.password, clientId: getClientId(), name: nameRef.current })
        } else {
          sig.joinRoom({ roomId: sessionRef.current.roomId, password: sessionRef.current.password, clientId: getClientId(), name: nameRef.current })
        }
      }
    })

    sig.on('error', ({ message }) => {
      setError(message)
    })

    sig.on('room-created', ({ roomId: rid, memberId }) => {
      setMembers([{ id: memberId, name: nameRef.current || '房主', role: 'host' }])
      setPhase('room')
      setRoomId(rid)
      setRole('host')
      sessionRef.current = { roomId: rid, password: sessionRef.current?.password ?? '' }
      setError(null)
    })

    sig.on('room-joined', ({ roomId: rid, hostId, members: ms }) => {
      hostIdRef.current = hostId
      setMembers(ms)
      setPhase('room')
      setRoomId(rid)
      setRole('guest')
      setError(null)
    })

    sig.on('members', ({ members: ms }) => setMembers(ms))

    sig.on('peer-joined', ({ peerId }) => {
      if (roleRef.current !== 'host') return
      const stream = localStreamRef.current
      if (stream) {
        void createHostPeer(peerId)
      } else {
        pendingPeersRef.current.add(peerId)
      }
    })

    sig.on('peer-left', ({ peerId }) => {
      const pc = peersRef.current.get(peerId)
      if (pc) {
        closePeer(pc)
        peersRef.current.delete(peerId)
      }
      pendingPeersRef.current.delete(peerId)
      setHostPeerStates((prev) => {
        const next = { ...prev }
        delete next[peerId]
        return next
      })
    })

    sig.on('signal', async ({ from, data }) => {
      if (roleRef.current === 'host') {
        // 房主只收观众的 answer / ice
        const pc = peersRef.current.get(from)
        if (pc) await handleSignal(pc, data)
        return
      }
      // 观众只收房主的 offer / ice
      if (from !== hostIdRef.current) return
      const sigNow = signalingRef.current
      if (!sigNow) return
      let pc = peersRef.current.get(from)
      if (!pc) {
        pc = await createSubscriberPeer(
          (d) => sigNow.signal(from, d),
          (stream) => {
            setRemoteStream(stream)
            setError(null)
          },
          { onStateChange: (s) => setGuestConnState(s) }
        )
        peersRef.current.set(from, pc)
      }
      const answer = await handleSignal(pc, data)
      if (answer) sigNow.signal(from, { sdp: answer })
    })

    sig.on('host-left', ({ message }) => {
      setError(message)
      resetToHome()
    })

    sig.connect()
    return sig
  }, [createHostPeer, resetToHome])

  const createRoom = useCallback(
    (password: string) => {
      const sig = ensureSignaling()
      const name = nameRef.current.trim() || getDefaultName()
      saveName(name)
      sig.createRoom({ password, clientId: getClientId(), name })
    },
    [ensureSignaling]
  )

  const joinRoom = useCallback(
    (code: string, password: string) => {
      const sig = ensureSignaling()
      const name = nameRef.current.trim() || getDefaultName()
      saveName(name)
      sig.joinRoom({ roomId: code, password, clientId: getClientId(), name })
    },
    [ensureSignaling]
  )

  return (
    <>
      {phase === 'home' && (
        <Home
          serverUrl={serverUrl}
          onServerUrlChange={(v) => setServerUrl(v)}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          error={error}
          onDismissError={() => setError(null)}
        />
      )}
      {phase === 'room' && (
        <Room
          role={role}
          roomId={roomId}
          members={members}
          wsState={wsState}
          error={error}
          onDismissError={() => setError(null)}
          localStream={localStream}
          sharedName={sharedName}
          hostPeerStates={hostPeerStates}
          remoteStream={remoteStream}
          guestConnState={guestConnState}
          onOpenPicker={() => setPickerOpen(true)}
          onStopShare={stopShare}
          onLeave={leaveRoom}
        />
      )}
      <SharePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(id, name) => {
          setPickerOpen(false)
          void startShare(id, name)
        }}
      />
    </>
  )
}
