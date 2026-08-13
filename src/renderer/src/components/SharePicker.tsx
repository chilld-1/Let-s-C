import { useEffect, useState } from 'react'
import { DEFAULT_QUALITY, QUALITY_PROFILES, type QualityTier } from '../lib/peer'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (windowId: string, windowName: string, quality: QualityTier) => void
}

interface WindowInfo {
  id: string
  name: string
  thumbnail: string | null
}

export default function SharePicker({ open, onClose, onSelect }: Props): React.JSX.Element | null {
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [quality, setQuality] = useState<QualityTier>(DEFAULT_QUALITY)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setErr(null)
    window.api
      .listWindows()
      .then((list) => setWindows(list))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>选择要共享的窗口</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <p className="hint">
          只共享你选中的这个窗口；切换到其他应用时，观众那边不会看到其他内容。
        </p>

        <div className="quality-picker">
          <span className="quality-label">画质</span>
          {(Object.keys(QUALITY_PROFILES) as QualityTier[]).map((tier) => (
            <button
              key={tier}
              type="button"
              className={`quality-option ${quality === tier ? 'active' : ''}`}
              onClick={() => setQuality(tier)}
            >
              <span className="quality-name">{QUALITY_PROFILES[tier].label}</span>
              <span className="quality-hint">{QUALITY_PROFILES[tier].hint}</span>
            </button>
          ))}
        </div>

        <div className="window-list">
          {loading && <div className="empty">正在枚举窗口…</div>}
          {!loading && err && <div className="empty error-text">{err}</div>}
          {!loading && !err && windows.length === 0 && (
            <div className="empty">没有检测到可共享的窗口</div>
          )}
          {!loading &&
            !err &&
            windows.map((w) => (
              <button
                key={w.id}
                className="window-item"
                onClick={() => onSelect(w.id, w.name, quality)}
                title={w.name}
              >
                <div className="window-thumb">
                  {w.thumbnail ? (
                    <img src={w.thumbnail} alt="" />
                  ) : (
                    <span className="thumb-placeholder">无预览</span>
                  )}
                </div>
                <span className="window-name">{w.name}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
