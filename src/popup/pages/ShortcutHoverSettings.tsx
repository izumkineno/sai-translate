import { createSignal, onMount } from 'solid-js'
import {
  loadHoverConfig,
  updateHoverConfig,
  DEFAULT_HOVER_CONFIG,
  type HoverIconPosition,
  type ImagePayloadMode,
} from '../store/hoverConfig'
export default function ShortcutHoverSettings() {
  const [hoverEnabled, setHoverEnabled] = createSignal(DEFAULT_HOVER_CONFIG.hoverEnabled)
  const [hoverHighlight, setHoverHighlight] = createSignal(DEFAULT_HOVER_CONFIG.hoverHighlight)
  const [hoverIcon, setHoverIcon] = createSignal(DEFAULT_HOVER_CONFIG.hoverIcon)
  const [hoverDashed, setHoverDashed] = createSignal(DEFAULT_HOVER_CONFIG.hoverDashed)
  const [highlightColor, setHighlightColor] = createSignal(DEFAULT_HOVER_CONFIG.hoverHighlightColor)
  const [dashedColor, setDashedColor] = createSignal(DEFAULT_HOVER_CONFIG.hoverDashedColor)
  const [dashedWidth, setDashedWidth] = createSignal(DEFAULT_HOVER_CONFIG.hoverDashedWidth)
  const [iconPos, setIconPos] = createSignal<HoverIconPosition>(DEFAULT_HOVER_CONFIG.hoverIconPosition)
  const [exclude, setExclude] = createSignal(DEFAULT_HOVER_CONFIG.hoverExcludeSelectors)
  const [inlineEnabled, setInlineEnabled] = createSignal(DEFAULT_HOVER_CONFIG.inlineEnabled)
  const [targetLang, setTargetLang] = createSignal(DEFAULT_HOVER_CONFIG.targetLang)
  const [shortcutKey, setShortcutKey] = createSignal(DEFAULT_HOVER_CONFIG.shortcutKey)
  const [imageMode, setImageMode] = createSignal<ImagePayloadMode>(DEFAULT_HOVER_CONFIG.imageMode)
  const [saving, setSaving] = createSignal(false)
  const [msg, setMsg] = createSignal('')
  onMount(async () => {
    const cfg = await loadHoverConfig()
    setHoverEnabled(cfg.hoverEnabled)
    setHoverHighlight(cfg.hoverHighlight)
    setHoverIcon(cfg.hoverIcon)
    setHoverDashed(cfg.hoverDashed)
    setHighlightColor(cfg.hoverHighlightColor)
    setDashedColor(cfg.hoverDashedColor)
    setDashedWidth(cfg.hoverDashedWidth)
    setIconPos(cfg.hoverIconPosition)
    setExclude(cfg.hoverExcludeSelectors)
    setInlineEnabled(cfg.inlineEnabled)
    setTargetLang(cfg.targetLang)
    setShortcutKey(cfg.shortcutKey)
    setImageMode(cfg.imageMode)
  })

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true)
    setMsg('')
    try {
      await updateHoverConfig(patch as never)
      setMsg('已保存')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const openShortcuts = () => {
    try {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
    } catch {
      // fallback
      window.open('chrome://extensions/shortcuts', '_blank')
    }
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
      <div class="n-layout-content__header">
        <div class="n-layout-content__title">快捷键 / Hover</div>
        <span style={{ 'font-size': '12px', color: 'var(--n-text-3)' }}>沉浸式方案</span>
      </div>

      {/* 快捷键 */}
      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">快捷键</span>
          <span class="n-card-header__extra">双轨</span>
        </div>
        <div class="n-card__content" style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
          <div class="n-alert n-alert--info" style={{ 'font-size': '12px' }}>
            主快捷键 <b>Alt+Shift+T</b>（系统级）可在 <button class="n-button n-button--text" style="padding:0 4px" onClick={openShortcuts} type="button">chrome://extensions/shortcuts</button> 修改<br />
            页内快捷键 <b>Alt+{shortcutKey().replace('Key','')}</b> 可在此配置
          </div>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <span style={{ width: '120px' }}>页内键 (Alt+?)</span>
            <select
              value={shortcutKey()}
              onChange={(e) => {
                const v = e.currentTarget.value
                setShortcutKey(v)
                void save({ shortcutKey: v })
              }}
              class="n-input"
              style={{ flex: '1', padding: '6px 8px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}
            >
              <option value="KeyQ">Q</option>
              <option value="KeyT">T</option>
              <option value="KeyY">Y</option>
              <option value="KeyS">S</option>
              <option value="KeyD">D</option>
            </select>
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <span style={{ width: '120px' }}>默认目标语言</span>
            <select
              value={targetLang()}
              onChange={(e) => {
                const v = e.currentTarget.value
                setTargetLang(v)
                void save({ targetLang: v })
              }}
              class="n-input"
              style={{ flex: '1', padding: '6px 8px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}
            >
              <option value="中文">中文</option>
              <option value="English">English</option>
              <option value="日本語">日本語</option>
              <option value="한국어">한국어</option>
              <option value="Français">Français</option>
              <option value="Deutsch">Deutsch</option>
              <option value="Auto">Auto</option>
            </select>
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <input
              type="checkbox"
              checked={inlineEnabled()}
              onChange={(e) => {
                const v = e.currentTarget.checked
                setInlineEnabled(v)
                void save({ inlineEnabled: v })
              }}
            />
            启用行下插入（关闭则快捷键不 inject）
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <span style={{ width: '120px' }}>图片翻译模式</span>
            <select
              value={imageMode()}
              onChange={(e) => {
                const v = e.currentTarget.value as ImagePayloadMode
                setImageMode(v)
                void save({ imageMode: v })
              }}
              class="n-input"
              style={{ flex: '1', padding: '6px 8px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}
            >
              <option value="auto">智能（小图 base64 / 大图·跨域 URL）</option>
              <option value="url">始终 URL（服务端拉取，省 base64）</option>
              <option value="base64">始终 Base64（本地转码，失败回退 URL）</option>
            </select>
          </label>
          <div style={{ 'font-size': '11px', color: '#6b7280', 'line-height': '1.4' }}>
            远端地址走后端 <code>reqwest</code> 拉取（跳过 CORS），超时 40s；base64 过大（&gt;10MiB）自动回退 URL，对应服务端 §3.1 混用
          </div>
        </div>
      </div>

      {/* Hover 预选 */}
      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">Hover 预选高亮</span>
          <span class="n-card-header__extra">不调 LLM</span>
        </div>
        <div class="n-card__content" style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '13px' }}>
            <input type="checkbox" checked={hoverEnabled()} onChange={(e) => { const v = e.currentTarget.checked; setHoverEnabled(v); void save({ hoverEnabled: v }) }} />
            总开关（关闭则无高亮/图标/虚线）
          </label>
          <div style={{ display: 'flex', gap: '12px', 'flex-wrap': 'wrap' }}>
            <label style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'font-size': '12px' }}>
              <input type="checkbox" checked={hoverHighlight()} onChange={(e) => { const v = e.currentTarget.checked; setHoverHighlight(v); void save({ hoverHighlight: v }) }} />
              高亮背景
            </label>
            <label style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'font-size': '12px' }}>
              <input type="checkbox" checked={hoverDashed()} onChange={(e) => { const v = e.currentTarget.checked; setHoverDashed(v); void save({ hoverDashed: v }) }} />
              虚线边框
            </label>
            <label style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'font-size': '12px' }}>
              <input type="checkbox" checked={hoverIcon()} onChange={(e) => { const v = e.currentTarget.checked; setHoverIcon(v); void save({ hoverIcon: v }) }} />
              译图标
            </label>
          </div>

          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            <label style={{ flex: '1 1 140px', display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px' }}>
              高亮颜色
              <input type="color" value={highlightColor()} onInput={(e) => { const v = e.currentTarget.value; setHighlightColor(v); void save({ hoverHighlightColor: v }) }} style={{ width: '100%', height: '32px' }} />
            </label>
            <label style={{ flex: '1 1 140px', display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px' }}>
              虚线颜色
              <input type="color" value={dashedColor()} onInput={(e) => { const v = e.currentTarget.value; setDashedColor(v); void save({ hoverDashedColor: v }) }} style={{ width: '100%', height: '32px' }} />
            </label>
            <label style={{ flex: '1 1 80px', display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px' }}>
              虚线宽度
              <select value={String(dashedWidth())} onChange={(e) => { const v = Number(e.currentTarget.value); setDashedWidth(v); void save({ hoverDashedWidth: v }) }} style={{ padding: '6px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}>
                <option value="1">1px</option>
                <option value="2">2px</option>
                <option value="3">3px</option>
              </select>
            </label>
            <label style={{ flex: '1 1 120px', display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px' }}>
              图标位置
              <select value={iconPos()} onChange={(e) => { const v = e.currentTarget.value as HoverIconPosition; setIconPos(v); void save({ hoverIconPosition: v }) }} style={{ padding: '6px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}>
                <option value="top-right">右上角</option>
                <option value="bottom-right">右下角</option>
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px' }}>
            排除选择器（逗号分隔，命中不高亮）
            <input
              class="n-input"
              value={exclude()}
              onInput={(e) => setExclude(e.currentTarget.value)}
              onBlur={() => void save({ hoverExcludeSelectors: exclude() })}
              placeholder="pre,code"
              style={{ padding: '6px 8px', 'border-radius': '6px', border: '1px solid #e5e7eb' }}
            />
          </label>

          {msg() && <div style={{ 'font-size': '12px', color: '#059669' }}>{msg()}</div>}
          {saving() && <div style={{ 'font-size': '12px', color: '#6b7280' }}>保存中…</div>}
        </div>
      </div>

      <div style={{ 'font-size': '11px', color: '#9ca3af', 'text-align': 'center' }}>
        Hover 仅预选不发请求，按 Alt+Shift+T / Alt+Q 翻译 hover 块或选中文本
      </div>
    </div>
  )
}
