// Hover preselection — visual only, no LLM
// Shows sentence-level highlight (Highlight API) + block icon/dashed, fully customizable

import { findBestBlockAtPoint, findBestBlockForRange, findBestImageAtPoint, findBestImageForRange, getSentenceRangeAtPoint } from './utils/selection'

type HoverCfg = {
  enabled: boolean
  highlight: boolean
  icon: boolean
  dashed: boolean
  highlightColor: string
  dashedColor: string
  dashedWidth: number
  iconPosition: 'top-right' | 'bottom-right'
  excludeSelectors: string
}

const DEFAULT: HoverCfg = {
  enabled: true,
  highlight: true,
  icon: true,
  dashed: true,
  highlightColor: '#fef08a',
  dashedColor: '#e5e7eb',
  dashedWidth: 1,
  iconPosition: 'top-right',
  excludeSelectors: 'pre,code,[contenteditable]',
}

let cfgLoaded = false
let cfg: HoverCfg = { ...DEFAULT }
let currentAnchor: HTMLElement | null = null
let currentImageAnchor: HTMLImageElement | null = null
let currentSentenceRange: Range | null = null
let currentSentenceText: string | null = null
let iconEl: HTMLElement | null = null
let prevBlockStyle: { bg: string; outline: string; boxShadow: string } | null = null

function shouldExclude(el: Element): boolean {
  const sel = cfg.excludeSelectors.trim()
  if (!sel) return false
  try { return !!el.closest(sel) } catch { return false }
}

function findAnchorFromPoint(target: Element | null, x: number, y: number): HTMLElement | null {
  if (!target) return null
  if (shouldExclude(target)) return null
  // Image first — same-origin loaded <img> takes precedence over text blocks
  try {
    const img = findBestImageAtPoint(x, y, cfg.excludeSelectors)
    if (img) return img
  } catch {}
  // Use best block at point
  const best = findBestBlockAtPoint(x, y, cfg.excludeSelectors)
  if (best) return best
  // fallback simple
  let el = target as HTMLElement
  // walk up to block
  const isBlock = (e: HTMLElement) => {
    const d = getComputedStyle(e).display
    return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || e.tagName === 'P' || /^H[1-6]$/.test(e.tagName)
  }
  while (el && el !== document.body && !isBlock(el)) el = el.parentElement as HTMLElement
  if (!el || el === document.body) return null
  if (shouldExclude(el)) return null
  const txt = (el.textContent || '').trim()
  if (txt.length < 2) return null
  return el
}

function findAnchorFromRange(): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null
  try {
    const range = sel.getRangeAt(0)
    try {
      const img = findBestImageForRange(range, cfg.excludeSelectors)
      if (img) return img
    } catch {}
    const best = findBestBlockForRange(range, cfg.excludeSelectors)
    if (best) return best
    // fallback to first block ancestor
    let node: Node | null = range.commonAncestorContainer
    if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement
    let el = node as HTMLElement | null
    const isBlockLocal = (e: HTMLElement) => {
      const d = getComputedStyle(e).display
      return d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || e.tagName === 'P' || /^H[1-6]$/.test(e.tagName)
    }
    while (el && el !== document.body && !isBlockLocal(el)) el = el.parentElement
    return el && el !== document.body ? el : null
  } catch {
    return null
  }
}

function ensureIcon(): HTMLElement {
  if (iconEl) return iconEl
  const el = document.createElement('div')
  el.dataset.saiHoverIcon = '1'
  el.style.cssText = `
    position:fixed; width:22px; height:22px; border-radius:6px; margin:0; padding:0;
    background:#111827; color:#fff; display:flex; align-items:center; justify-content:center;
    font-size:12px; line-height:1; box-shadow:0 2px 8px rgba(0,0,0,.2);
    cursor:pointer; z-index:2147483645; pointer-events:auto;
  `
  el.textContent = '译'
  el.title = '按 Alt+Shift+T 翻译此句/块'
  el.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('sai:iconClick', { detail: { anchor: currentAnchor, sentence: currentSentenceText, range: currentSentenceRange } }))
  })
  iconEl = el
  return el
}

function ensureHighlightStyle() {
 if (document.getElementById('sai-highlight-style')) return
 const s = document.createElement('style')
 s.id = 'sai-highlight-style'
 s.textContent = `::highlight(sai-sentence) { background-color: ${cfg.highlightColor}; }`
 document.head.appendChild(s)
}

function applySentenceHighlight(range: Range | null) {
 clearSentenceHighlight()
 if (!range || !cfg.highlight) return
 try {
 const HL = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
 const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
 if (typeof HL === 'function' && highlights) {
 ensureHighlightStyle()
 const styleEl = document.getElementById('sai-highlight-style')
 if (styleEl) styleEl.textContent = `::highlight(sai-sentence) { background-color: ${cfg.highlightColor}; }`
 const h = new (HL as unknown as new (r: Range) => unknown)(range)
 highlights.set('sai-sentence', h as never)
 return
 }
 } catch {}
}

function clearSentenceHighlight() {
 try {
 const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
 if (highlights) highlights.delete('sai-sentence')
 } catch {}
}

function applyBlockHighlight(anchor: HTMLElement) {
  if (!cfg.highlight && !cfg.dashed) return
  prevBlockStyle = { bg: anchor.style.backgroundColor, outline: anchor.style.outline, boxShadow: anchor.style.boxShadow }
  const isImg = anchor.tagName === 'IMG'
  // If sentence highlight is active, skip block bg to avoid double (not relevant for images)
  if (currentSentenceRange && cfg.highlight && !isImg) {
    // only dashed for block when sentence highlighted
    if (cfg.dashed) {
      anchor.style.outline = `${cfg.dashedWidth}px dashed ${cfg.dashedColor}`
      anchor.style.outlineOffset = '2px'
    }
    return
  }
  if (isImg) {
    // For <img> use outline + boxShadow, no background
    if (cfg.dashed) {
      anchor.style.outline = `${cfg.dashedWidth}px dashed ${cfg.dashedColor}`
      anchor.style.outlineOffset = '2px'
      anchor.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.04)'
    } else if (cfg.highlight) {
      anchor.style.outline = `2px solid ${cfg.highlightColor}`
      anchor.style.outlineOffset = '2px'
    }
    return
  }
  if (cfg.highlight) {
    anchor.style.backgroundColor = cfg.highlightColor
    anchor.style.transition = 'background-color .15s'
  }
  if (cfg.dashed) {
    anchor.style.outline = `${cfg.dashedWidth}px dashed ${cfg.dashedColor}`
    anchor.style.outlineOffset = '2px'
  }
}

function removeBlockHighlight(anchor: HTMLElement) {
  if (prevBlockStyle) {
    anchor.style.backgroundColor = prevBlockStyle.bg
    anchor.style.outline = prevBlockStyle.outline
    anchor.style.boxShadow = prevBlockStyle.boxShadow
    prevBlockStyle = null
  } else {
    anchor.style.backgroundColor = ''
    anchor.style.outline = ''
    anchor.style.outlineOffset = ''
    anchor.style.boxShadow = ''
  }
}

function showIconFor(anchor: HTMLElement) {
  if (!cfg.icon) return
  const icon = ensureIcon()
  // 统一 fixed + body 挂载：absolute 挂 anchor 内时，祖先 overflow:hidden 会裁掉图标、
  // 祖先层叠上下文会锁住层级；fixed 以视口 rect 定位彻底免疫这两类
  const rect = anchor.getBoundingClientRect()
  icon.style.position = 'fixed'
  icon.style.left = ''
  if (cfg.iconPosition === 'top-right') {
    icon.style.top = `${rect.top + 6}px`
    icon.style.right = `${window.innerWidth - rect.right + 6}px`
    icon.style.bottom = ''
  } else {
    icon.style.top = ''
    icon.style.bottom = `${window.innerHeight - rect.bottom + 6}px`
    icon.style.right = `${window.innerWidth - rect.right + 6}px`
  }
  if (icon.parentElement !== document.body) document.body.appendChild(icon)
}

function hideIcon() {
  if (iconEl && iconEl.parentElement) iconEl.remove()
}

function setCurrentByPoint(x: number, y: number, target: Element | null) {
  const anchor = findAnchorFromPoint(target, x, y)
  const isImg = anchor?.tagName === 'IMG'
  if (currentAnchor === anchor && anchor !== null) {
    if (isImg) {
      // same image — keep highlight, reposition icon if needed
      if (cfg.icon) showIconFor(anchor)
      return
    }
    // same block, but sentence may differ — update sentence highlight
    const sent = getSentenceRangeAtPoint(x, y)
    if (sent && sent.block === anchor) {
      if (sent.sentence !== currentSentenceText) {
        currentSentenceRange = sent.range
        currentSentenceText = sent.sentence
        applySentenceHighlight(sent.range)
      }
    } else if (!sent && currentSentenceRange) {
      clearSentenceHighlight()
      currentSentenceRange = null
      currentSentenceText = null
      // restore block highlight if needed
      if (anchor && !prevBlockStyle) applyBlockHighlight(anchor)
    }
    return
  }
  // different anchor — clear previous
  if (currentAnchor) {
    clearSentenceHighlight()
    removeBlockHighlight(currentAnchor)
    hideIcon()
    currentSentenceRange = null
    currentSentenceText = null
  }
  currentAnchor = anchor
  currentImageAnchor = isImg ? (anchor as HTMLImageElement) : null
  if (anchor) {
    if (isImg) {
      currentSentenceRange = null
      currentSentenceText = null
      clearSentenceHighlight()
      applyBlockHighlight(anchor)
    } else {
      // Try sentence-level highlight at point
      const sent = getSentenceRangeAtPoint(x, y)
      if (sent && sent.block === anchor && sent.sentence.length >= 2 && sent.sentence.length < 600) {
        currentSentenceRange = sent.range
        currentSentenceText = sent.sentence
        applySentenceHighlight(sent.range)
        // also apply dashed for block context
        applyBlockHighlight(anchor)
      } else {
        currentSentenceRange = null
        currentSentenceText = null
        applyBlockHighlight(anchor)
      }
    }
    showIconFor(anchor)
  } else {
    clearSentenceHighlight()
    currentImageAnchor = null
  }
}

export function getCurrentAnchor(): HTMLElement | null {
  const sel = window.getSelection()
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    try {
      const best = (findAnchorFromRange() as HTMLElement | null)
      if (best) return best
    } catch {}
  }
  return currentAnchor
}

export function getCurrentImageAnchor(): HTMLImageElement | null {
  if (currentImageAnchor) return currentImageAnchor
  if (currentAnchor && currentAnchor.tagName === 'IMG') return currentAnchor as HTMLImageElement
  const sel = window.getSelection()
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    try {
      const r = sel.getRangeAt(0)
      const img = findBestImageForRange(r, cfg.excludeSelectors)
      if (img) return img
    } catch {}
  }
  return null
}

export function getHoverSentence(): string | null {
  return currentSentenceText
}

export function getHoverSentenceRange(): Range | null {
  return currentSentenceRange
}

export function getHoverConfig(): HoverCfg {
  return { ...cfg }
}

async function loadCfg() {
  try {
    const keys = [
      'sai_hover_enabled',
      'sai_hover_highlight',
      'sai_hover_icon',
      'sai_hover_dashed',
      'sai_hover_highlight_color',
      'sai_hover_dashed_color',
      'sai_hover_dashed_width',
      'sai_hover_icon_position',
      'sai_hover_exclude_selectors',
    ] as const
    const raw = await chrome.storage.local.get(keys as unknown as string[])
    if (typeof raw['sai_hover_enabled'] === 'boolean') cfg.enabled = raw['sai_hover_enabled'] as boolean
    if (typeof raw['sai_hover_highlight'] === 'boolean') cfg.highlight = raw['sai_hover_highlight'] as boolean
    if (typeof raw['sai_hover_icon'] === 'boolean') cfg.icon = raw['sai_hover_icon'] as boolean
    if (typeof raw['sai_hover_dashed'] === 'boolean') cfg.dashed = raw['sai_hover_dashed'] as boolean
    if (typeof raw['sai_hover_highlight_color'] === 'string') cfg.highlightColor = raw['sai_hover_highlight_color'] as string
    if (typeof raw['sai_hover_dashed_color'] === 'string') cfg.dashedColor = raw['sai_hover_dashed_color'] as string
    if (typeof raw['sai_hover_dashed_width'] === 'number') cfg.dashedWidth = raw['sai_hover_dashed_width'] as number
    if (raw['sai_hover_icon_position'] === 'top-right' || raw['sai_hover_icon_position'] === 'bottom-right') cfg.iconPosition = raw['sai_hover_icon_position'] as HoverCfg['iconPosition']
    if (typeof raw['sai_hover_exclude_selectors'] === 'string') cfg.excludeSelectors = raw['sai_hover_exclude_selectors'] as string
    const styleEl = document.getElementById('sai-highlight-style')
    if (styleEl) styleEl.textContent = `::highlight(sai-sentence) { background-color: ${cfg.highlightColor}; }`
  } catch {}
  cfgLoaded = true
}

export function initHover() {
  void loadCfg()
  chrome.storage.onChanged.addListener((changes) => {
    let need = false
    for (const k of Object.keys(changes)) if (k.startsWith('sai_hover')) { need = true; break }
    if (need) void loadCfg().then(() => {
      if (currentAnchor) {
        // re-apply highlights with new colors / respect new toggles
        if (!cfg.enabled) {
          clearSentenceHighlight()
          removeBlockHighlight(currentAnchor)
          hideIcon()
        } else {
          if (currentSentenceRange && cfg.highlight) applySentenceHighlight(currentSentenceRange)
          else clearSentenceHighlight()
          if (cfg.dashed) applyBlockHighlight(currentAnchor); else removeBlockHighlight(currentAnchor)
          if (cfg.icon) showIconFor(currentAnchor); else hideIcon()
        }
      } else if (cfg.enabled) {
        // no anchor, nothing to re-apply
      }
    })
  })

  let lastMove = 0
  let lastX = 0, lastY = 0
  document.addEventListener('mousemove', (e) => {
    // 关键修复：配置未加载完成前不展示任何 hover 态，避免新页闪现背景/高亮/图标
    if (!cfgLoaded) return
    if (!cfg.enabled) {
      if (currentAnchor) {
        clearSentenceHighlight()
        removeBlockHighlight(currentAnchor)
        hideIcon()
        currentAnchor = null
        currentImageAnchor = null
        currentSentenceRange = null
        currentSentenceText = null
      }
      return
    }
    const now = Date.now()
    if (now - lastMove < 80) {
      if (Math.abs(e.clientX - lastX) < 12 && Math.abs(e.clientY - lastY) < 12) return
    }
    lastMove = now
    lastX = e.clientX; lastY = e.clientY
    const target = document.elementFromPoint(e.clientX, e.clientY) as Element | null
    if ((e.target as HTMLElement)?.dataset?.saiHoverIcon) return
    setCurrentByPoint(e.clientX, e.clientY, target as HTMLElement | null)
  }, { passive: true })

  // fixed 图标不随 anchor 滚动，scroll/resize 时按 currentAnchor 重定位（rAF 节流）
  let iconRaf = 0
  const repositionIcon = () => {
    try { cancelAnimationFrame(iconRaf) } catch {}
    iconRaf = requestAnimationFrame(() => {
      if (iconEl && iconEl.isConnected && currentAnchor && currentAnchor.isConnected && cfg.icon) {
        showIconFor(currentAnchor)
      }
    })
  }
  window.addEventListener('scroll', repositionIcon, { passive: true, capture: true })
  window.addEventListener('resize', repositionIcon)

  window.addEventListener('sai:clearHover', () => {
    if (currentAnchor) {
      clearSentenceHighlight()
      removeBlockHighlight(currentAnchor)
      hideIcon()
    }
    currentAnchor = null
    currentImageAnchor = null
    currentSentenceRange = null
    currentSentenceText = null
  })
}
export function clearHover() {
  if (currentAnchor) {
    clearSentenceHighlight()
    removeBlockHighlight(currentAnchor)
    hideIcon()
  }
  currentAnchor = null
  currentImageAnchor = null
  currentSentenceRange = null
  currentSentenceText = null
}
