import { useState } from 'react'

interface Props {
  serverUrl: string
  onServerUrlChange: (v: string) => void
  onCreateRoom: (password: string) => void
  onJoinRoom: (code: string, password: string) => void
  error: string | null
  onDismissError: () => void
}

export default function Home({
  serverUrl,
  onServerUrlChange,
  onCreateRoom,
  onJoinRoom,
  error,
  onDismissError
}: Props): React.JSX.Element {
  const [name, setName] = useState(localStorage.getItem('lets-c-name') ?? '')
  const [createPwd, setCreatePwd] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinPwd, setJoinPwd] = useState('')
  const [showAdv, setShowAdv] = useState(false)

  const saveName = () => {
    if (name.trim()) localStorage.setItem('lets-c-name', name.trim())
  }

  const validCode = /^[A-Za-z2-9]{6}$/.test(joinCode.trim())

  return (
    <div className="home">
      <header className="home-header">
        <h1>
          Let&apos;s <span className="accent">C</span>
        </h1>
        <p className="subtitle">共享屏幕 · 多人一起刷 B 站（P2P 直连，画面不经过服务器）</p>
      </header>

      <main className="home-body">
        <section className="panel">
          <label className="field">
            <span>昵称</span>
            <input
              value={name}
              maxLength={20}
              placeholder="给自己起个名字"
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
            />
          </label>

          <div className="grid-2">
            <div className="card">
              <h2>创建房间</h2>
              <p className="hint">成为房主，共享你的屏幕，邀请好友一起看</p>
              <label className="field">
                <span>房间密码（可选）</span>
                <input
                  type="password"
                  value={createPwd}
                  placeholder="不填则任何人可加入"
                  onChange={(e) => setCreatePwd(e.target.value)}
                />
              </label>
              <button className="btn primary" onClick={() => onCreateRoom(createPwd)}>
                创建房间并共享
              </button>
            </div>

            <div className="card">
              <h2>加入房间</h2>
              <p className="hint">输入房主分享的房间码，实时观看</p>
              <label className="field">
                <span>房间码</span>
                <input
                  value={joinCode}
                  maxLength={6}
                  placeholder="6 位房间码"
                  style={{ textTransform: 'uppercase' }}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                />
              </label>
              <label className="field">
                <span>房间密码（如有）</span>
                <input
                  type="password"
                  value={joinPwd}
                  placeholder="房主未设密码则留空"
                  onChange={(e) => setJoinPwd(e.target.value)}
                />
              </label>
              <button
                className="btn primary"
                disabled={!validCode}
                title={validCode ? '' : '请输入 6 位房间码'}
                onClick={() => {
                  saveName()
                  onJoinRoom(joinCode.trim(), joinPwd)
                }}
              >
                加入房间
              </button>
            </div>
          </div>
        </section>

        <details className="adv" open={showAdv} onToggle={(e) => setShowAdv((e.target as HTMLDetailsElement).open)}>
          <summary>高级设置（信令服务器地址）</summary>
          <label className="field">
            <span>信令服务器</span>
            <input
              value={serverUrl}
              placeholder="ws://localhost:8787"
              onChange={(e) => onServerUrlChange(e.target.value)}
            />
          </label>
          <p className="hint">
            信令服务器仅用于交换连接信息（房间码 / 密码校验 / SDP / ICE），视频与声音通过 P2P 直连，不经过服务器。
          </p>
        </details>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={onDismissError} aria-label="关闭">
              ✕
            </button>
          </div>
        )}
      </main>

      <footer className="home-footer">
        仅共享所选窗口 · 切换其他应用时观众不可见
      </footer>
    </div>
  )
}
