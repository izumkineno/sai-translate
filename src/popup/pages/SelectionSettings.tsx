import { createSignal, onMount } from 'solid-js'
import { loadHoverConfig, updateHoverConfig, DEFAULT_HOVER_CONFIG } from '../store/hoverConfig'

export default function SelectionSettings() {
  const [enabled, setEnabled] = createSignal(DEFAULT_HOVER_CONFIG.selectionEnabled)
  const [auto, setAuto] = createSignal(DEFAULT_HOVER_CONFIG.selectionAuto)
  const [shortcut, setShortcut] = createSignal(DEFAULT_HOVER_CONFIG.selectionShortcut)
  const [selKey, setSelKey] = createSignal(DEFAULT_HOVER_CONFIG.selectionKey)
  const [minLength, setMinLength] = createSignal(DEFAULT_HOVER_CONFIG.selectionMinLength)
  const [saving, setSaving] = createSignal(false)
  const [msg, setMsg] = createSignal('')

  onMount(async () => {
    const cfg = await loadHoverConfig()
    setEnabled(cfg.selectionEnabled)
    setAuto(cfg.selectionAuto)
    setShortcut(cfg.selectionShortcut)
    setSelKey(cfg.selectionKey)
    setMinLength(cfg.selectionMinLength)
  })

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await updateHoverConfig(patch as Parameters<typeof updateHoverConfig>[0])
      setMsg('已保存')
      setTimeout(() => setMsg(''), 1200)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
      <div class="n-layout-content__header">
        <div class="n-layout-content__title">划词翻译</div>
      </div>

      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">总开关</span>
        </div>
        <div class="n-card__content" style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <input
              type="checkbox"
              checked={enabled()}
              onChange={(e) => {
                const v = e.currentTarget.checked
                setEnabled(v)
                void save({ selectionEnabled: v })
              }}
            />
            启用（关闭后选中文本不再翻译）
          </label>
          <div style={{ 'font-size': '11px', color: '#6b7280', 'line-height': '1.4' }}>
            划词翻译只能以翻译窗口形式展示，不受悬浮翻译显示模式（卡片/沉浸式）影响。
          </div>
        </div>
      </div>

      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">触发方式</span>
          <span class="n-card-header__extra">自动 / 快捷键</span>
        </div>
        <div class="n-card__content" style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <input
              type="checkbox"
              checked={auto()}
              disabled={!enabled()}
              onChange={(e) => {
                const v = e.currentTarget.checked
                setAuto(v)
                void save({ selectionAuto: v })
              }}
            />
            自动触发（松开鼠标约半秒后翻译选中文本，无需按键）
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <span style={{ width: '120px' }}>自动触发最小字数</span>
            <input
              type="number"
              min="1"
              max="50"
              value={minLength()}
              disabled={!enabled() || !auto()}
              onChange={(e) => {
                const raw = Math.round(Number(e.currentTarget.value))
                const v = Number.isFinite(raw) ? Math.max(1, Math.min(50, raw)) : DEFAULT_HOVER_CONFIG.selectionMinLength
                setMinLength(v)
                void save({ selectionMinLength: v })
              }}
              class="n-input"
              style={{ flex: '1', padding: '6px 8px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}
            />
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <input
              type="checkbox"
              checked={shortcut()}
              disabled={!enabled()}
              onChange={(e) => {
                const v = e.currentTarget.checked
                setShortcut(v)
                void save({ selectionShortcut: v })
              }}
            />
            快捷键触发（选中后按选词键翻译；关闭则按键不再翻译选区）
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <span style={{ width: '120px' }}>选词键 (Alt+?)</span>
            <select
              value={selKey()}
              disabled={!enabled() || !shortcut()}
              onChange={(e) => {
                const v = e.currentTarget.value
                setSelKey(v)
                void save({ selectionKey: v })
              }}
              class="n-input"
              style={{ flex: '1', padding: '6px 8px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}
            >
              <option value="KeyR">R</option>
              <option value="KeyT">T</option>
              <option value="KeyY">Y</option>
              <option value="KeyS">S</option>
              <option value="KeyD">D</option>
            </select>
          </label>
          <div style={{ 'font-size': '11px', color: '#6b7280', 'line-height': '1.4' }}>
            自动触发跳过输入框、译文卡片与过短选区；再次选中已译段落则关闭译文。
            系统选词键 Alt+Shift+S（仅翻译选区，无选区不执行）。
          </div>
          {msg() && <div style={{ 'font-size': '12px', color: '#059669' }}>{msg()}</div>}
          {saving() && <div style={{ 'font-size': '12px', color: '#6b7280' }}>保存中…</div>}
        </div>
      </div>
    </div>
  )
}
