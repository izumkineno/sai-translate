// Shadow DOM row-below injection, multi-card, MutationObserver + 一键关闭悬浮条

type CardStatus = 'loading' | 'success' | 'error' | 'empty'

const CARD_ATTR = 'data-sai'
const HOST_CLASS = 'sai-translate-inline'

const cardMap = new Map<HTMLElement, HTMLElement>() // anchor -> host (row-below card)
const observerMap = new Map<HTMLElement, MutationObserver>()
const imageOverlayMap = new Map<HTMLElement, HTMLElement>() // anchor(img) -> overlay (fixed covering)
// --- 浮窗盔甲：Shadow 只保护卡片内部，host 本体是页面流里的裸 div ---
// 被盖三路径：页面 sticky/fixed 头滚过盖住行下卡片；祖先层叠上下文（transform/filter/
// opacity）把卡片锁在低层；通用选择器（div:empty{display:none}——host light-DOM 为空，
// 正中 :empty；div{overflow:hidden} 等）直接污染 host。
// position:relative 无偏移，不影响行下流式布局；updateCard 经 createHost 全覆盖。
function applyHostArmor(host: HTMLElement): void {
  const s = host.style
  s.setProperty('display', 'block', 'important')
  s.setProperty('position', 'relative', 'important')
  s.setProperty('z-index', '2147483647', 'important')
  s.setProperty('isolation', 'isolate', 'important')
  s.setProperty('overflow', 'visible', 'important')
  s.setProperty('visibility', 'visible', 'important')
  s.setProperty('opacity', '1', 'important')
  s.setProperty('float', 'none', 'important')
  s.setProperty('transform', 'none', 'important')
  s.setProperty('filter', 'none', 'important')
  s.setProperty('clip-path', 'none', 'important')
  s.setProperty('-webkit-mask', 'none', 'important')
  s.setProperty('mask', 'none', 'important')
  s.setProperty('max-width', 'none', 'important')
  s.setProperty('animation', 'none', 'important')
  s.setProperty('transition', 'none', 'important')
}
// overlay 是功能性 fixed 覆盖层：display/visibility 由显隐逻辑驱动，不锁；
// 只锁定位与盒模型（页面 div{position:absolute} 会直接改掉 fixed 造成错位/被盖）。
function applyOverlayArmor(overlay: HTMLElement): void {
  const s = overlay.style
  s.setProperty('position', 'fixed', 'important')
  s.setProperty('z-index', '2147483645', 'important')
  s.setProperty('overflow', 'hidden', 'important')
  s.setProperty('pointer-events', 'none', 'important')
  s.setProperty('box-sizing', 'border-box', 'important')
  s.setProperty('line-height', '0', 'important')
  s.setProperty('margin', '0', 'important')
  s.setProperty('padding', '0', 'important')
  s.setProperty('transform', 'none', 'important')
  s.setProperty('isolation', 'isolate', 'important')
}

// --- 一键关闭悬浮条 ---
let closeAllHost: HTMLElement | null = null
let closeAllCountEl: HTMLElement | null = null

function createCloseAllHost(): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-sai-close-all', '1')
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:none;pointer-events:auto;margin:0;padding:0;'
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
// --- 图片 overlay（完全覆盖源图） ---
function isImageAnchor(el: HTMLElement): boolean {
  return el.tagName === 'IMG'
}
function updateOverlayPosition(anchor: HTMLElement, overlay: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  // 完全贴合源图
  overlay.style.top = rect.top + 'px'
  overlay.style.left = rect.left + 'px'
  overlay.style.width = rect.width + 'px'
  overlay.style.height = rect.height + 'px'
  // 同步圆角/边框，避免突兀
  try {
    const cs = getComputedStyle(anchor)
    // 圆角
    ;(overlay.firstElementChild as HTMLElement | null)?.style.setProperty('border-radius', cs.borderRadius)
    overlay.style.borderRadius = cs.borderRadius
    // 隐藏判定：零尺寸或 display none 或不在 DOM
    const isZero = rect.width < 2 || rect.height < 2
    const isHidden = cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && parseFloat(cs.opacity) === 0)
    if (isZero || isHidden) overlay.style.visibility = 'hidden'
    else overlay.style.visibility = 'visible'
  } catch {}
}
let overlayRaf = 0 as number | ReturnType<typeof setTimeout>
let overlayListenerInited = false
function ensureOverlayPositionListener() {
  if (overlayListenerInited) return
  overlayListenerInited = true
  const schedule = () => {
    try { cancelAnimationFrame(overlayRaf as number) } catch {}
    overlayRaf = requestAnimationFrame(() => {
      for (const [anchor, overlay] of Array.from(imageOverlayMap.entries())) {
        if (!anchor.isConnected || !document.contains(anchor)) {
          overlay.remove()
          imageOverlayMap.delete(anchor)
          continue
        }
        if (!overlay.isConnected) {
          imageOverlayMap.delete(anchor)
          continue
        }
        updateOverlayPosition(anchor, overlay)
      }
    }) as unknown as number
  }
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  window.addEventListener('resize', schedule)
  // 监听布局抖动（图片懒加载后尺寸变化）
  try {
    const ro = new ResizeObserver(schedule)
    // 懒观察，新增 overlay 时再 observe 单图由 create 处处理，此处仅全局 resize
    void ro
  } catch {}
  // 定时兜底（1s）应对 getBoundingClientRect 动画
  setInterval(schedule, 1000)
}
function createOrUpdateImageOverlay(anchor: HTMLImageElement, dataUrl: string): HTMLElement {
  let overlay = imageOverlayMap.get(anchor)
  if (overlay) {
    const img = overlay.querySelector('img') as HTMLImageElement | null
    if (img) img.src = dataUrl
    updateOverlayPosition(anchor, overlay)
    overlay.style.display = 'block'
    // 提到 body 末尾：同 z 的页面节点若后挂载会盖住 overlay
    try { document.body.appendChild(overlay) } catch {}
    return overlay
  }
  overlay = document.createElement('div')
  overlay.setAttribute('data-sai-overlay', '1')
  applyOverlayArmor(overlay)
  overlay.style.background = '#ffffff'
  updateOverlayPosition(anchor, overlay)
  const img = document.createElement('img')
  img.src = dataUrl
  img.alt = ''
  img.style.width = '100%'
  img.style.height = '100%'
  img.style.display = 'block'
  try {
    const cs = getComputedStyle(anchor)
    img.style.objectFit = (cs.objectFit as string) || 'fill'
    img.style.objectPosition = (cs.objectPosition as string) || 'center'
    overlay.style.borderRadius = cs.borderRadius
    img.style.borderRadius = cs.borderRadius
  } catch {
    img.style.objectFit = 'fill'
  }
  overlay.appendChild(img)
  // Sync border radius after append
  try { updateOverlayPosition(anchor, overlay) } catch {}
  document.body.appendChild(overlay)
  imageOverlayMap.set(anchor, overlay)
  ensureOverlayPositionListener()
  // 监听单图尺寸变化
  try {
    const ro = new ResizeObserver(() => updateOverlayPosition(anchor, overlay!))
    ro.observe(anchor)
    // 存于 overlay 上便于清理（弱存）
    ;(overlay as unknown as Record<string, unknown>)._ro = ro
  } catch {}
  return overlay
}
function toggleImageOverlay(anchor: HTMLElement): boolean {
  const overlay = imageOverlayMap.get(anchor)
  if (!overlay) return false
  const isHidden = overlay.style.display === 'none'
  if (isHidden) {
    overlay.style.display = 'block'
    updateOverlayPosition(anchor, overlay)
    return true
  } else {
    overlay.style.display = 'none'
    return false
  }
}
function removeImageOverlay(anchor: HTMLElement) {
  const overlay = imageOverlayMap.get(anchor)
  if (!overlay) return
  try {
    const ro = (overlay as unknown as Record<string, unknown>)._ro as ResizeObserver | undefined
    if (ro) ro.disconnect()
  } catch {}
  overlay.remove()
  imageOverlayMap.delete(anchor)
}


function createHost(): HTMLElement {
  const host = document.createElement('div')
  host.className = HOST_CLASS
  host.setAttribute(CARD_ATTR, '1')
  host.style.display = 'block'
  host.style.margin = '6px 0 10px'
  applyHostArmor(host)
  return host
}

function buildShadow(
  host: HTMLElement,
  status: CardStatus,
  text: string,
  meta: string,
  onCopy: () => void,
  onRetranslate: () => void,
  onClose: () => void,
  annotatedDataUrl?: string,
  anchor?: HTMLElement,
): ShadowRoot {
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { display:block; font-family: inherit; }
    .box { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px; font-size:13px; line-height:1.6; color:#1f2937; box-shadow:0 4px 16px rgba(0,0,0,.08); }
    .meta { font-size:11px; color:#6b7280; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
    .body { white-space:pre-wrap; word-break:break-word; }
    .actions { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
    .btn { font-size:12px; padding:4px 8px; border-radius:6px; border:1px solid #e5e7eb; background:#f9fafb; cursor:pointer; }
    .btn:hover { background:#f3f4f6; }
    .btn:active { background:#e5e7eb; }
    .close { background:transparent; border:none; cursor:pointer; font-size:16px; line-height:1; color:#6b7280; }
    .close:hover { color:#111827; }
    .spin { display:inline-block; width:12px; height:12px; border:2px solid #e5e7eb; border-top-color:#6b7280; border-radius:50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg) } }
    .error { color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px; }
    .thumb { max-width:100%; max-height:240px; object-fit:contain; border:1px solid #eee; border-radius:6px; margin-top:8px; display:block; cursor:pointer; }
    @media (prefers-color-scheme: dark) {
      .box { background:#1f2937; border-color:#374151; color:#f3f4f6; }
      .meta { color:#9ca3af; }
      .btn { background:#374151; border-color:#4b5563; color:#f3f4f6; }
      .error { background:#450a0a; border-color:#7f1d1d; color:#fecaca; }
      .thumb { border-color:#374151; }
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
    const isImg = !!(anchor && isImageAnchor(anchor) && annotatedDataUrl)
    // 图片 overlay 模式：译图完全覆盖源图，字幕卡仅作切换中枢（不再在卡内嵌缩略图）
    if (isImg) {
      try {
        createOrUpdateImageOverlay(anchor as HTMLImageElement, annotatedDataUrl!)
      } catch {}
    } else if (status === 'success' && annotatedDataUrl) {
      // 非图片锚点的兜底缩略（保留兼容）
      const thumb = document.createElement('img')
      thumb.className = 'thumb'
      thumb.src = annotatedDataUrl
      thumb.alt = '译图'
      thumb.title = '点击在新标签打开'
      thumb.addEventListener('click', () => {
        try { window.open(annotatedDataUrl, '_blank') } catch {}
      })
      box.appendChild(thumb)
    }
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
    actions.append(copy, retr)
    if (isImg) {
      const toggle = document.createElement('button')
      toggle.className = 'btn'
      // 初始为覆盖译文态
      const overlay = anchor ? imageOverlayMap.get(anchor) : undefined
      const isOverlayVisible = overlay ? overlay.style.display !== 'none' : true
      toggle.textContent = isOverlayVisible ? '显示原文' : '显示译文'
      toggle.title = isOverlayVisible ? '隐藏译图，显示原图' : '显示译图覆盖'
      toggle.addEventListener('click', () => {
        if (!anchor) return
        const nowVisible = toggleImageOverlay(anchor)
        // toggleImageOverlay 返回 true=变为可见（显示译文），false=隐藏（显示原文）
        if (nowVisible) {
          toggle.textContent = '显示原文'
          toggle.title = '隐藏译图，显示原图'
        } else {
          toggle.textContent = '显示译文'
          toggle.title = '显示译图覆盖'
        }
      })
      actions.append(toggle)
    }
    if (status === 'success' && annotatedDataUrl) {
      const dl = document.createElement('button')
      dl.className = 'btn'
      dl.textContent = '下载译图'
      dl.addEventListener('click', () => {
        try {
          const a = document.createElement('a')
          a.href = annotatedDataUrl!
          let name = 'image'
          if (anchor instanceof HTMLImageElement && anchor.alt) name = anchor.alt
          else if (anchor instanceof HTMLImageElement && anchor.src) {
            try {
              const u = new URL(anchor.src, location.href)
              const base = u.pathname.split('/').pop() || 'image'
              name = base.split('.')[0] || 'image'
            } catch {}
          }
          name = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 40) || 'image'
          a.download = name + '_translated.png'
          document.body.appendChild(a)
          a.click()
          setTimeout(() => { try { a.remove() } catch {} }, 100)
        } catch {}
      })
      const open = document.createElement('button')
      open.className = 'btn'
      open.textContent = '新标签打开'
      open.addEventListener('click', () => {
        try { window.open(annotatedDataUrl!, '_blank') } catch {}
      })
      actions.append(dl, open)
    }
    actions.append(mkCloseBtn(onClose))
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

// --- 沉浸式双语（手法借鉴 FluentRead appendBilingualTranslation + page.css） ---
// 核心：译文 span 直接挂进原文 anchor 内部 → 字体/颜色/字号/行高全继承，零成本“复刻样式”，
// 不拷贝 computed style、不改原文；左侧色标用 ::before 伪元素（零新增元素）；
// translate=no 防页面翻译器二次处理；data-sai-immersive 做幂等与状态机。
// 新增元素总共 2 个：译文 span + hover 才显现的关闭按钮，最大限度不干扰版式。
const IMM_ATTR = 'data-sai-immersive'
const IMM_STYLE_ID = 'sai-immersive-style'
const IMM_MARKER_VAR = '--sai-imm-marker'
const DISPLAY_MODE_KEY = 'sai_translate_display_mode'
const IMM_MARKER_KEY = 'sai_translate_immersive_marker_color'
export type DisplayMode = 'card' | 'immersive'
type ImmersiveStatus = 'loading' | 'success' | 'error'

// 模块级偏好缓存：injectLoading 刷新 + storage 监听实时跟随，updateCard 同步可用
let displayModeNow: DisplayMode = 'card'
let markerNow = '#409eff'
let immStoreHooked = false

function applyMarkerColor(marker: string): void {
  try { document.documentElement.style.setProperty(IMM_MARKER_VAR, marker) } catch {}
}
function parseMarkerColor(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#409eff'
}
async function refreshDisplayPrefs(): Promise<void> {
  try {
    const raw = await chrome.storage.local.get([DISPLAY_MODE_KEY, IMM_MARKER_KEY])
    displayModeNow = raw[DISPLAY_MODE_KEY] === 'immersive' ? 'immersive' : 'card'
    markerNow = parseMarkerColor(raw[IMM_MARKER_KEY])
  } catch {
    displayModeNow = 'card'
    markerNow = '#409eff'
  }
  applyMarkerColor(markerNow)
  hookImmersiveStore()
}
function hookImmersiveStore(): void {
  if (immStoreHooked) return
  immStoreHooked = true
  try {
    chrome.storage.onChanged.addListener((changes) => {
      try {
        const dm = changes[DISPLAY_MODE_KEY]?.newValue
        if (dm !== undefined) displayModeNow = dm === 'immersive' ? 'immersive' : 'card'
        const c = changes[IMM_MARKER_KEY]?.newValue
        if (typeof c === 'string') {
          markerNow = parseMarkerColor(c)
          applyMarkerColor(markerNow)
        }
      } catch {}
    })
  } catch {}
}

function ensureImmersiveStyle(): void {
  if (document.getElementById(IMM_STYLE_ID)) return
  const s = document.createElement('style')
  s.id = IMM_STYLE_ID
  s.textContent = `
    [${IMM_ATTR}] { display:block; margin:6px 0 10px; padding-left:12px; color:inherit; background:transparent; overflow-wrap:break-word; }
    [${IMM_ATTR}]::before { content:""; position:absolute; left:0; top:0.2em; bottom:0.2em; width:3px; border-radius:999px; background:var(${IMM_MARKER_VAR},#409eff); pointer-events:none; }
    [${IMM_ATTR}="loading"] { opacity:.55; animation:sai-imm-pulse 1.1s ease-in-out infinite; }
    @keyframes sai-imm-pulse { 0%,100% { opacity:.35; } 50% { opacity:.7; } }
    [${IMM_ATTR}="error"] { color:#b91c1c; cursor:pointer; }
    [${IMM_ATTR}-close] { position:absolute; top:0; right:0; width:20px; height:20px; border:none; border-radius:6px; background:#111827; color:#fff; font-size:12px; line-height:1; cursor:pointer; opacity:0; transition:opacity .15s; padding:0; margin:0; }
    [${IMM_ATTR}]:hover > [${IMM_ATTR}-close] { opacity:.85; }
  `
  // [${IMM_ATTR}-close] 展开为 [data-sai-immersive-close]，与关闭按钮属性一致
  try { document.head.appendChild(s) } catch { try { document.documentElement.appendChild(s) } catch {} }
}

function isImmersiveHost(el: HTMLElement): boolean {
  return el.hasAttribute(IMM_ATTR)
}

function buildImmersive(anchor: HTMLElement, status: ImmersiveStatus, text: string): HTMLElement {
  ensureImmersiveStyle()
  const wrap = document.createElement('span')
  wrap.setAttribute(CARD_ATTR, '1')
  wrap.setAttribute(IMM_ATTR, status)
  wrap.setAttribute('translate', 'no')
  // relative 必须内联：::before 与关闭按钮 absolute 定位锚点，且不被页面样式表覆盖
  wrap.style.position = 'relative'
  const body = document.createElement('span')
  body.textContent = status === 'loading' ? '翻译中…' : text
  wrap.appendChild(body)
  if (status === 'error') wrap.title = '点击重试'
  const close = document.createElement('button')
  close.setAttribute(`${IMM_ATTR}-close`, '1')
  close.type = 'button'
  close.textContent = '×'
  close.title = '关闭译文'
  close.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    removeCard(anchor)
  })
  wrap.appendChild(close)
  return wrap
}

// 原地刷新：保留节点身份，只换状态与文本（幂等，不抖动版式）
function refreshImmersive(host: HTMLElement, status: ImmersiveStatus, text: string): void {
  host.setAttribute(IMM_ATTR, status)
  const body = host.firstElementChild
  if (body instanceof HTMLElement) body.textContent = status === 'loading' ? '翻译中…' : text
  host.title = status === 'error' ? '点击重试' : ''
}

// 最新重试闭包存 WeakMap，监听器只绑一次（updateCard 每次传的新闭包语义等价：同 text + anchor）
const immersiveRetryMap = new WeakMap<HTMLElement, () => void>()
function setImmersiveRetry(host: HTMLElement, fn: () => void): void {
  immersiveRetryMap.set(host, fn)
  if (!host.dataset.saiImmRetry) {
    host.dataset.saiImmRetry = '1'
    host.addEventListener('click', (e) => {
      const t = e.target
      if (t instanceof HTMLElement && t.hasAttribute(`${IMM_ATTR}-close`)) return
      const f = immersiveRetryMap.get(host)
      if (f) f()
    })
  }
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
  await refreshDisplayPrefs()
  // 图片锚点永远走卡片 + overlay（行下复刻对 IMG 无意义）
  if (displayModeNow === 'immersive' && anchor.tagName !== 'IMG') {
    const wrap = buildImmersive(anchor, 'loading', '')
    placeAfter(anchor, wrap)
    observe(anchor, wrap)
    return wrap
  }
  const host = createHost()
  const onCopy = () => {}
  const onRetr = () => {}
  const onClose = () => removeCard(anchor)
  buildShadow(host, 'loading', '', '翻译中…', onCopy, onRetr, onClose)
  placeAfter(anchor, host)
  observe(anchor, host)
  return host
}

export function updateCard(anchor: HTMLElement, status: CardStatus, text: string, meta: string, onRetranslate: () => void, annotatedDataUrl?: string) {
  const wantImmersive = displayModeNow === 'immersive' && anchor.tagName !== 'IMG'
  let host = cardMap.get(anchor)
  // 形态不符（设置页中途切换显示模式）→ 拆掉按新形态重建
  if (host && isImmersiveHost(host) !== wantImmersive) {
    try { host.remove() } catch {}
    cardMap.delete(anchor)
    const oldObs = observerMap.get(anchor)
    if (oldObs) { oldObs.disconnect(); observerMap.delete(anchor) }
    host = undefined
  }
  if (wantImmersive) {
    const immStatus: ImmersiveStatus = status === 'error' ? 'error' : status === 'loading' ? 'loading' : 'success'
    if (host) {
      refreshImmersive(host, immStatus, text)
      if (immStatus === 'error') setImmersiveRetry(host, onRetranslate)
      return
    }
    const wrap = buildImmersive(anchor, immStatus, text)
    if (immStatus === 'error') setImmersiveRetry(wrap, onRetranslate)
    placeAfter(anchor, wrap)
    observe(anchor, wrap)
    return
  }
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
  if (!host) {
    // 无 host（loading 与结果竞态/切模式后）：直接建卡，语义同 injectBelow
    const newHost = createHost()
    buildShadow(newHost, status, text, meta, onCopy, onRetranslate, onClose, annotatedDataUrl, anchor)
    placeAfter(anchor, newHost)
    observe(anchor, newHost)
    return
  }
  // detach old shadow by replacing host
  const newHost = createHost()
  buildShadow(newHost, status, text, meta, onCopy, onRetranslate, onClose, annotatedDataUrl, anchor)
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
      // For void IMG, ensure insertion after the image even if parent is inline
      try {
        anchor.after(host)
      } catch {
        // fallback: parent insert
        const parent = anchor.parentElement
        if (parent) {
          try { parent.insertBefore(host, anchor.nextSibling) } catch { anchor.appendChild(host) }
        } else {
          document.body.appendChild(host)
        }
      }
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
            } catch {
              try {
                const p = anchor.parentElement
                if (p) p.insertBefore(host, anchor.nextSibling)
              } catch {}
            }
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
  // 同步清理图片 overlay 覆盖层
  removeImageOverlay(anchor)
  window.dispatchEvent(new CustomEvent('sai:clearHover'))
  try { updateCloseAllButton() } catch {}
}
export function removeAll() {
  for (const [anchor] of Array.from(cardMap.entries())) removeCard(anchor)
  // 图片 overlay 兜底清理
  for (const [anchor] of Array.from(imageOverlayMap.entries())) removeImageOverlay(anchor)
  try { document.querySelectorAll<HTMLElement>(`[data-sai-overlay="1"]`).forEach((el) => { try { el.remove() } catch {} }) } catch {}
  // 兜底：直接清理所有残留的译文 host（防止旧版本或异常未入 map 的节点）
  try {
    document.querySelectorAll<HTMLElement>(`[${CARD_ATTR}="1"]`).forEach((el) => {
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
  // 卡片 host 的 display 被盔甲锁了 important，普通赋值无效，必须同级 important
  for (const h of cardMap.values()) h.style.setProperty('display', anyVisible ? 'none' : 'block', 'important')
  // 图片 overlay 同步显隐
  for (const ov of imageOverlayMap.values()) ov.style.display = anyVisible ? 'none' : 'block'
}

// spec required alias: injectBelow after anchor — thin wrapper around placeAfter+buildShadow
export function injectBelow(
  anchor: HTMLElement,
  status: CardStatus,
  text: string,
  meta: string,
  onRetranslate: () => void,
  annotatedDataUrl?: string,
): HTMLElement {
  let host = cardMap.get(anchor)
  if (!host) {
    host = createHost()
    const onCopy = async () => {
      try { await navigator.clipboard.writeText(text) } catch {}
    }
    const onClose = () => removeCard(anchor)
    buildShadow(host, status, text, meta, onCopy, onRetranslate, onClose, annotatedDataUrl, anchor)
    placeAfter(anchor, host)
    observe(anchor, host)
    return host
  }
  updateCard(anchor, status, text, meta, onRetranslate, annotatedDataUrl)
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
