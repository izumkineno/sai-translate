import { createSignal, Show } from 'solid-js'
import ModelTranslate from './pages/ModelTranslate'
import Settings from './pages/Settings'
import ShortcutHoverSettings from './pages/ShortcutHoverSettings'
import './App.css'

type NavKey = 'translate' | 'config' | 'shortcut-hover'

export default function App() {
  const [active, setActive] = createSignal<NavKey>('translate')
  const [closing, setClosing] = createSignal(false)
  const onCloseAllGlobal = async () => {
    setClosing(true)
    try {
      // 经 background 广播到所有标签页，兼容单页直连回退
      try { await chrome.runtime.sendMessage({ type: 'SAI_CLOSE_ALL' }) } catch {}
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]
        if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'SAI_CLOSE_ALL' }).catch(() => {})
      } catch {}
    } finally { setTimeout(() => setClosing(false), 800) }
  }


  return (
    <div class="n-layout has-sider">
      {/* Sider — Naive n-layout-sider + n-menu: 独立 tabs */}
      <aside class="n-layout-sider" style={{ display: 'flex', 'flex-direction': 'column', 'justify-content': 'space-between' }}>
        <nav class="n-menu" aria-label="导航">
          <button
            class={`n-menu-item ${active() === 'translate' ? 'n-menu-item--active' : ''}`}
            onClick={() => setActive('translate')}
            type="button"
          >
            <span class="n-menu-item__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 8l-2 6 2 2 2-2-1.5-3" />
                <path d="M9 8h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" />
                <path d="M12 12h.01" />
                <path d="M9 13v1" />
                <path d="M15 13v1" />
                <path d="M12 4v2" />
              </svg>
            </span>
            翻译
          </button>

          <button
            class={`n-menu-item ${active() === 'config' ? 'n-menu-item--active' : ''}`}
            onClick={() => setActive('config')}
            type="button"
          >
            <span class="n-menu-item__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4 9a1.65 1.65 0 0 0 1-1.51V7a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 15 9a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 15Z" />
              </svg>
            </span>
            模型配置
          </button>

          <button
            class={`n-menu-item ${active() === 'shortcut-hover' ? 'n-menu-item--active' : ''}`}
            onClick={() => setActive('shortcut-hover')}
            type="button"
          >
            <span class="n-menu-item__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 16l-2 4 4-1" />
                <path d="M10 8h4" />
                <path d="M12 8v4" />
              </svg>
            </span>
            快捷键/Hover
          </button>
        </nav>
        <div style={{ padding: '12px', 'border-top': '1px solid var(--n-border-color, #eee)', 'margin-top': 'auto' }}>
          <button class="n-button n-button--ghost" style={{ width: '100%', 'font-size': '12px' }} type="button" onClick={onCloseAllGlobal} disabled={closing()}>
            {closing() ? '关闭中…' : '🗑 关闭全部译文'}
          </button>
        </div>
      </aside>
      {/* Content — independent tabs */}
      <main class="n-layout-content">
        <Show when={active() === 'translate'}>
          <ModelTranslate />
        </Show>
        <Show when={active() === 'config'}>
          <Settings />
        </Show>
        <Show when={active() === 'shortcut-hover'}>
          <ShortcutHoverSettings />
        </Show>
      </main>
    </div>
  )
}
