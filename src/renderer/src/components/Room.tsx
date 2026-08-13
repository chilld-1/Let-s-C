import { useRef, useState } from 'react'
import type { Member } from '../lib/signaling'

type Role = 'host' | 'guest'

interface Props {
  role: Role | null
  roomId: string | null
  members: Member[]
  wsState: 'idle' | 'connected' | 'disconnected' | 'reconnecting'
  error: string | null
  onDismissError: () => void
  // 房主
  localStream: MediaStream | null
  sharedName: string | null
  hostPeerStates: Record<string, string>
  onOpenPicker: () => void
  onStopShare: () => void
  // 观众
  remoteStream: MediaStream | null
  guestConnState: string
  onLeave: () => void
}

const CONN_LABEL: Record<string, string> = {
  new: '等待房主共享…',
  connecting: '正在连接房主…',
  connected: '已连接',
  disconnected: '连接断开',
  failed: '连接失败',
  closed: '连接已关闭'
}

export default function Room(props: Props): React.JSX.Element {
  const {
    role,
    roomId,
    members,
    wsState,
    error,
    onDismissError,
    localStream,
    sharedName,
    hostPeerStates,
    onOpenPicker,
    onStopShare,
    remoteStream,
    guestConnState,
    onLeave
  } = props

  const hostVideoRef = useRef<HTMLVideoElement>(null)
  const guestVideoRef = useRef<HTMLVideoElement>(null)
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    if (!roomId) return
    try {
      await navigator.clipboard.writeText(roomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时降级
    }
  }

  const bindStream = (ref: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
  }

  return (
    <div className="room">
      <header className="room-bar">
        <div className="room-bar-left">
          <span className="logo-sm">
            Let&apos;s <span className="accent">C</span>
          </span>
          {roomId && (
            <button className="room-code" onClick={() => void copyCode()} title="点击复制">
              <span className="code-text">{roomId}</span>
              <span className="copy-hint">{copied ? '已复制 ✓' : '复制'}</span>
            </button>
          )}
          <span className="member-count">👥 {members.length} 人</span>
          {wsState !== 'connected' && (
            <span className="ws-state">
              {wsState === 'reconnecting' ? '连接中断，重连中…' : '信令连接断开'}
            </span>
          )}
        </div>
        <div className="room-bar-right">
          <span className="role-tag">{role === 'host' ? '房主' : '观众'}</span>
          <button className="btn ghost" onClick={onLeave}>
            离开房间
          </button>
        </div>
      </header>

      <main className="room-body">
        {role === 'host' ? (
          <HostView
            localStream={localStream}
            sharedName={sharedName}
            hostPeerStates={hostPeerStates}
            members={members}
            videoRef={hostVideoRef}
            bindStream={bindStream}
            onOpenPicker={onOpenPicker}
            onStopShare={onStopShare}
          />
        ) : (
          <GuestView
            remoteStream={remoteStream}
            guestConnState={guestConnState}
            members={members}
            videoRef={guestVideoRef}
            bindStream={bindStream}
          />
        )}
      </main>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={onDismissError} aria-label="关闭">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function HostView(props: {
  localStream: MediaStream | null
  sharedName: string | null
  hostPeerStates: Record<string, string>
  members: Member[]
  videoRef: React.RefObject<HTMLVideoElement | null>
  bindStream: (ref: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) => void
  onOpenPicker: () => void
  onStopShare: () => void
}): React.JSX.Element {
  const { localStream, sharedName, hostPeerStates, members, videoRef, bindStream, onOpenPicker, onStopShare } = props
  bindStream(videoRef, localStream)
  const guestCount = members.filter((m) => m.role === 'guest').length

  return (
    <div className="host-view">
      <section className="stage">
        <div className="stage-head">
          <h2>我的共享</h2>
          {localStream ? (
            <div className="stage-actions">
              <span className="shared-tag">正在共享：{sharedName ?? '窗口'}</span>
              <button className="btn danger" onClick={onStopShare}>
                停止共享
              </button>
            </div>
          ) : (
            <div className="stage-actions">
              <button className="btn primary" onClick={onOpenPicker}>
                选择要共享的窗口
              </button>
            </div>
          )}
        </div>

        <div className="video-wrap">
          {localStream ? (
            <video ref={videoRef} autoPlay muted playsInline className="stage-video" />
          ) : (
            <div className="video-empty">
              <div className="empty-icon">🖥️</div>
              <p>还未共享任何窗口</p>
              <p className="hint">点击上方按钮，选择你正在刷 B 站的窗口（如浏览器、B 站客户端）</p>
            </div>
          )}
        </div>

        {guestCount > 0 && (
          <div className="guest-strip">
            {members
              .filter((m) => m.role === 'guest')
              .map((m) => (
                <span key={m.id} className={`guest-chip ${hostPeerStates[m.id] === 'connected' ? 'ok' : ''}`}>
                  {m.name}
                  <span className="chip-state">
                    {hostPeerStates[m.id] ? CONN_LABEL[hostPeerStates[m.id]] ?? hostPeerStates[m.id] : '等待连接'}
                  </span>
                </span>
              ))}
          </div>
        )}
      </section>

      <aside className="sidebar">
        <h3>成员列表</h3>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.id} className={m.role === 'host' ? 'is-host' : ''}>
              <span className="member-name">{m.name}</span>
              <span className="member-role">{m.role === 'host' ? '房主' : '观众'}</span>
            </li>
          ))}
        </ul>
        <p className="hint tip">提示：共享时请保持窗口可见；若窗口最小化，观众可能看到黑屏。</p>
      </aside>
    </div>
  )
}

function GuestView(props: {
  remoteStream: MediaStream | null
  guestConnState: string
  members: Member[]
  videoRef: React.RefObject<HTMLVideoElement | null>
  bindStream: (ref: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) => void
}): React.JSX.Element {
  const { remoteStream, guestConnState, members, videoRef, bindStream } = props
  bindStream(videoRef, remoteStream)

  return (
    <div className="guest-view">
      <section className="stage">
        <div className="stage-head">
          <h2>房主共享画面</h2>
          {guestConnState && guestConnState !== 'connected' && (
            <span className="conn-state">{CONN_LABEL[guestConnState] ?? guestConnState}</span>
          )}
        </div>
        <div className="video-wrap">
          {remoteStream ? (
            <video ref={videoRef} autoPlay playsInline className="stage-video" controls={false} />
          ) : (
            <div className="video-empty">
              <div className="empty-icon">📺</div>
              <p>{CONN_LABEL[guestConnState] ?? '等待房主共享…'}</p>
              <p className="hint">房主共享开始后，画面会自动出现</p>
            </div>
          )}
        </div>
      </section>

      <aside className="sidebar">
        <h3>成员列表</h3>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.id} className={m.role === 'host' ? 'is-host' : ''}>
              <span className="member-name">{m.name}</span>
              <span className="member-role">{m.role === 'host' ? '房主' : '观众'}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
