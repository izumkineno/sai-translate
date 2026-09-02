// Shadow DOM row-below injection, multi-card, MutationObserver + 一键关闭悬浮条

type CardStatus = 'loading' | 'success' | 'error' | 'empty'

const CARD_ATTR = 'data-sai'
const HOST_CLASS = 'sai-translate-inline'

const cardMap = new Map<HTMLElement, HTMLElement>() // anchor -> host
const observerMap = new Map<HTMLElement, MutationObserver>()

// --- 一键关闭悬浮条 ---
let closeAllHost: HTMLElement | null = null
let closeAllCountEl: HTMLElement | null = null

function createCloseAllHost(): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-sai-close-all', '1')
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:none;pointer-events:auto;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { display:block; font-family: inherit; }
    .bar { display:flex; align-items:center; gap:10px; background:#111827; color:#fff; border-radius:999px; padding:8px 14px 8px 16px; font-size:13px; line-height:1; box-shadow:0 8px 24px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.12); }
    .count { font-weight:600; white-space:nowrap; }
    .btn { appearance:none; border:none; background:#fff; color:#111827; border-radius:999px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; line-height:1; }
    .btn:hover { background:#f3f4f6; }
    .btn:active { background:#e5e7eb; }
    @media (prefers-color-scheme: dark) {
      .bar { background:#1f2937; border:1px solid #374151; }
      .btn { background:#374151; color:#f3f4f6; border:1px solid #4b5563; }
      .btn:hover { background:#4b5563; }
    }
  `
  const bar = document.createElement('div')
  bar.className = 'bar'
  const countEl = document.createElement('span')
  countEl.className = 'count'
  countEl.textContent = '已翻译 0 段'
  closeAllCountEl = countEl
  const btn = document.createElement('button')
  btn.className = 'btn'
  btn.type = 'button'
  btn.textContent = '关闭全部 ×'
  btn.title = '一键关闭所有译文窗口'
  btn.addEventListener('click', () => removeAll())
  bar.append(countEl, btn)
  shadow.append(style, bar)
  return host
}

export function updateCloseAllButton(): void {
  const count = cardMap.size
  if (count === 0) {
    if (closeAllHost) closeAllHost.style.display = 'none'
    return
  }
  if (!closeAllHost || !closeAllHost.isConnected) {
    closeAllHost = createCloseAllHost()
    // 挂到 documentElement 避免被 body 的 overflow 裁剪
    const mount = document.documentElement || document.body
    try { mount.appendChild(closeAllHost) } catch { try { document.body.appendChild(closeAllHost) } catch {} }
  }
  closeAllHost.style.display = 'block'
  if (closeAllCountEl) closeAllCountEl.textContent = `已翻译 ${count} 段`
}


function createHost(): HTMLElement {
  const host = document.createElement('div')
  host.className = HOST_CLASS
  host.setAttribute(CARD_ATTR, '1')
  host.style.display = 'block'
  host.style.margin = '6px 0 10px'
  return host
}

function buildShadow(host: HTMLElement, status: CardStatus, text: string, meta: string, onCopy: () => void, onRetranslate: () => void, onClose: () => void): ShadowRoot {
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { display:block; font-family: inherit; }
    .box { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px; font-size:13px; line-height:1.6; color:#1f2937; box-shadow:0 4px 16px rgba(0,0,0,.08); }
    .meta { font-size:11px; color:#6b7280; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
    .body { white-space:pre-wrap; word-break:break-word; }
    .actions { margin-top:8px; display:flex; gap:6px; }
    .btn { font-size:12px; padding:4px 8px; border-radius:6px; border:1px solid #e5e7eb; background:#f9fafb; cursor:pointer; }
    .btn:hover { background:#f3f4f6; }
    .btn:active { background:#e5e7eb; }
    .close { background:transparent; border:none; cursor:pointer; font-size:16px; line-height:1; color:#6b7280; }
    .close:hover { color:#111827; }
    .spin { display:inline-block; width:12px; height:12px; border:2px solid #e5e7eb; border-top-color:#6b7280; border-radius:50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg) } }
    .error { color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px; }
    @media (prefers-color-scheme: dark) {
      .box { background:#1f2937; border-color:#374151; color:#f3f4f6; }
      .meta { color:#9ca3af; }
      .btn { background:#374151; border-color:#4b5563; color:#f3f4f6; }
      .error { background:#450a0a; border-color:#7f1d1d; color:#fecaca; }
    }
  `
  const box = document.createElement('div')
  box.className = 'box'

  const metaEl = document.createElement('div')
  metaEl.className = 'meta'
  const left = document.createElement('span')
  left.textContent = meta
  const right = document.createElement('button')
  right.className = 'close'
  right.textContent = '×'
  right.title = '关闭'
  right.addEventListener('click', onClose)
  metaEl.append(left, right)

  box.appendChild(metaEl)

  if (status === 'loading') {
    const body = document.createElement('div')
    body.className = 'body'
    body.style.display = 'flex'
    body.style.alignItems = 'center'
    body.style.gap = '8px'
    const spin = document.createElement('span')
    spin.className = 'spin'
    spin.setAttribute('aria-hidden', 'true')
    const txt = document.createElement('span')
    txt.textContent = '翻译中…'
    body.append(spin, txt)
    box.appendChild(body)
  } else if (status === 'error') {
    const err = document.createElement('div')
    err.className = 'error'
    err.textContent = text
    box.appendChild(err)
    const actions = document.createElement('div')
    actions.className = 'actions'
    const retry = document.createElement('button')
    retry.className = 'btn'
    retry.textContent = '重试'
    retry.addEventListener('click', onRetranslate)
    actions.append(retry, mkCloseBtn(onClose))
    box.appendChild(actions)
  } else if (status === 'empty') {
    const body = document.createElement('div')
    body.className = 'body'
    body.textContent = text
    box.appendChild(body)
    box.appendChild(mkCloseBtnWrap(onClose))
  } else {
    const body = document.createElement('div')
    body.className = 'body'
    body.textContent = text
    box.appendChild(body)
    const actions = document.createElement('div')
    actions.className = 'actions'
    const copy = document.createElement('button')
    copy.className = 'btn'
    copy.textContent = '复制'
    copy.addEventListener('click', onCopy)
    const retr = document.createElement('button')
    retr.className = 'btn'
    retr.textContent = '重译'
    retr.addEventListener('click', onRetranslate)
    actions.append(copy, retr, mkCloseBtn(onClose))
    box.appendChild(actions)
  }

  shadow.append(style, box)
  return shadow
}

function mkCloseBtn(onClose: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'btn'
  b.textContent = '关闭'
  b.addEventListener('click', onClose)
  return b
}
function mkCloseBtnWrap(onClose: () => void): HTMLElement {
  const w = document.createElement('div')
  w.className = 'actions'
  w.append(mkCloseBtn(onClose))
  return w
}

function isInlineEnabledCache(): Promise<boolean> {
  return chrome.storage.local.get(['sai_translate_inline_enabled']).then((r) => {
    const v = r['sai_translate_inline_enabled']
    if (typeof v === 'boolean') return v
    return true
  }).catch(() => true)
}

export async function injectLoading(anchor: HTMLElement): Promise<HTMLElement> {
  const enabled = await isInlineEnabledCache()
  if (!enabled) throw new Error('行下翻译已关闭，请在配置页开启')
  const host = createHost()
  const onCopy = () => {}
  const onRetr = () => {}
  const onClose = () => removeCard(anchor)
  buildShadow(host, 'loading', '', '翻译中…', onCopy, onRetr, onClose)
  placeAfter(anchor, host)
  observe(anchor, host)
  return host
}

export function updateCard(anchor: HTMLElement, status: CardStatus, text: string, meta: string, onRetranslate: () => void) {
  const host = cardMap.get(anchor)
  if (!host) return
  // detach old shadow by replacing host
  const newHost = createHost()
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      ;(document as unknown as { execCommand(s: string): boolean }).execCommand('copy')
      ta.remove()
    }
  }
  const onClose = () => removeCard(anchor)
  buildShadow(newHost, status, text, meta, onCopy, onRetranslate, onClose)
  host.replaceWith(newHost)
  cardMap.set(anchor, newHost)
  // re-observe
  const obs = observerMap.get(anchor)
  if (obs) {
    obs.disconnect()
    observe(anchor, newHost)
  } else {
    observe(anchor, newHost)
  }
}
function placeAfter(anchor: HTMLElement, host: HTMLElement) {
  const isCell = anchor.tagName === 'TD' || anchor.tagName === 'TH'
  if (isCell) {
    const last = anchor.lastElementChild as HTMLElement | null
    if (last && last.getAttribute(CARD_ATTR) === '1') {
      last.replaceWith(host)
    } else {
      anchor.appendChild(host)
    }
  } else {
    const prev = anchor.nextElementSibling as HTMLElement | null
    if (prev && prev.getAttribute(CARD_ATTR) === '1') {
      prev.replaceWith(host)
    } else {
      anchor.after(host)
    }
  }
  cardMap.set(anchor, host)
  try { updateCloseAllButton() } catch {}
}

function observe(anchor: HTMLElement, host: HTMLElement) {
  const isCell = anchor.tagName === 'TD' || anchor.tagName === 'TH'
  const parent = isCell ? anchor : anchor.parentElement
  if (!parent) return
  const obs = new MutationObserver(() => {
    if (!host.isConnected) {
      setTimeout(() => {
        if (anchor.isConnected && !host.isConnected) {
          const cur = cardMap.get(anchor)
          if (cur === host) {
            try {
              if (isCell) anchor.appendChild(host)
              else anchor.after(host)
            } catch {}
          }
        }
      }, 200)
    }
  })
  obs.observe(parent, { childList: true })
  observerMap.set(anchor, obs)
}
export function removeCard(anchor: HTMLElement) {
  const host = cardMap.get(anchor)
  if (host) host.remove()
  cardMap.delete(anchor)
  const obs = observerMap.get(anchor)
  if (obs) { obs.disconnect(); observerMap.delete(anchor) }
  window.dispatchEvent(new CustomEvent('sai:clearHover'))
  try { updateCloseAllButton() } catch {}
}
export function removeAll() {
  for (const [anchor] of Array.from(cardMap.entries())) removeCard(anchor)
  // 兜底：直接清理所有残留的译文 host（防止旧版本或异常未入 map 的节点）
  try {
    document.querySelectorAll<HTMLElement>(`[${CARD_ATTR}=\"1\"]`).forEach((el) => {
      try { el.remove() } catch {}
    })
  } catch {}
  // 清理裸文本 marker 关联的悬浮条（marker 本身保留复用，仅隐藏条）
  try { updateCloseAllButton() } catch {}
  try { if (cardMap.size === 0 && closeAllHost) closeAllHost.style.display = 'none' } catch {}
}

export function hasCard(anchor: HTMLElement): boolean {
  return cardMap.has(anchor)
}

export function toggleInline(): void {
  const anyVisible = Array.from(cardMap.values()).some((h) => h.style.display !== 'none')
  for (const h of cardMap.values()) h.style.display = anyVisible ? 'none' : 'block'
}

// spec required alias: injectBelow after anchor — thin wrapper around placeAfter+buildShadow
export function injectBelow(
  anchor: HTMLElement,
  status: CardStatus,
  text: string,
  meta: string,
  onRetranslate: () => void,
): HTMLElement {
  let host = cardMap.get(anchor)
  if (!host) {
    host = createHost()
    const onCopy = async () => {
      try { await navigator.clipboard.writeText(text) } catch {}
    }
    const onClose = () => removeCard(anchor)
    buildShadow(host, status, text, meta, onCopy, onRetranslate, onClose)
    placeAfter(anchor, host)
    observe(anchor, host)
    return host
  }
  updateCard(anchor, status, text, meta, onRetranslate)
  return cardMap.get(anchor)!
}

export function closeLastCard(): void {
  const keys = Array.from(cardMap.keys())
  const last = keys[keys.length - 1]
  if (last) removeCard(last)
}

// auto cleanup on scroll out? we keep manual; Esc handled by main.ts
// expose for testing
export const __test = { cardMap, observerMap }
