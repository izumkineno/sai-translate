// Shortcut handling — dual track: commands (via background) + Alt+Q content
// 沉浸式风格：当锚点为多段落父容器时，展开为子段并通过限流队列逐个翻译

import { getCurrentAnchor, getHoverSentence } from './hover'
import { injectLoading, removeAll, hasCard, removeCard, updateCard } from './inject'
import {
  expandContainerToParagraphs,
  findBlockAnchor,
  getBlockText,
  getBlocksInRange,
  getSelectedText,
  getSelectedTextForBlock,
  isValidText,
} from './utils/selection'

type TranslateReq = { type: 'SAI_TRANSLATE'; text: string; target?: string; requestId: string }
type TranslateRes = { type: 'SAI_TRANSLATE_RESULT'; requestId: string; ok: boolean; translated?: string; error?: string; model?: string }

let shortcutKey = 'KeyQ'
let targetLang = '中文'

async function loadConfig() {
  try {
    const raw = await chrome.storage.local.get(['sai_translate_shortcut_key', 'sai_translate_target_lang'])
    const sk = raw['sai_translate_shortcut_key']
    if (typeof sk === 'string' && sk) shortcutKey = sk
    const tl = raw['sai_translate_target_lang']
    if (typeof tl === 'string' && tl) targetLang = tl
  } catch {}
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function doTranslate(text: string, anchor: HTMLElement | null, explicitTarget?: string) {
  const normalized = text.trim()
  if (!isValidText(normalized)) {
    if (anchor) {
      const host = await injectLoading(anchor)
      void host
      updateCard(anchor, 'error', '未选中有效文本', '错误', () => { void doTranslate(text, anchor, explicitTarget) })
    }
    return
  }
  let targetAnchor = anchor
  if (!targetAnchor) {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      try { targetAnchor = findBlockAnchor(sel.getRangeAt(0)) } catch {}
    }
  }
  if (!targetAnchor) targetAnchor = document.body as unknown as HTMLElement
  try {
    await injectLoading(targetAnchor)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '注入失败'
    updateCard(targetAnchor, 'error', msg, '错误', () => { void doTranslate(text, targetAnchor, explicitTarget) })
    return
  }
  const req: TranslateReq = {
    type: 'SAI_TRANSLATE',
    text: normalized.slice(0, 4000),
    target: explicitTarget || targetLang,
    requestId: genId(),
  }
  const send = () =>
    new Promise<TranslateRes>((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(req, (res: unknown) => {
          const err = chrome.runtime.lastError
          if (err) { reject(new Error(err.message)); return }
          if (!res || typeof res !== 'object') { reject(new Error('无响应')); return }
          const r = res as Record<string, unknown>
          if (r['type'] !== 'SAI_TRANSLATE_RESULT') { reject(new Error('响应类型错误')); return }
          resolve(r as unknown as TranslateRes)
        })
      } catch (e) { reject(e) }
    })
  try {
    const res = await send()
    if (res.ok) {
      const translated = typeof res.translated === 'string' ? res.translated : ''
      updateCard(targetAnchor, 'success', translated, `${res.model || 'LLM'} · ${req.target}`, () => { void doTranslate(text, targetAnchor, explicitTarget) })
    } else {
      const err = typeof res.error === 'string' ? res.error : '翻译失败'
      updateCard(targetAnchor, 'error', err, '错误', () => { void doTranslate(text, targetAnchor, explicitTarget) })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '请求失败'
    updateCard(targetAnchor, 'error', msg.slice(0, 200), '错误', () => { void doTranslate(text, targetAnchor, explicitTarget) })
  }
}

// ---------- 队列：沉浸式逐段翻译 ----------

const QUEUE_CONCURRENCY = 3
function getTextForQueuedBlock(b: HTMLElement, range: Range | null): string {
  // 裸文本 marker：优先取 dataset 存储的原始文本
  if ((b as HTMLElement & { dataset: DOMStringMap }).dataset?.saiUnwrapped === '1') {
    const v = (b as HTMLElement & { dataset: DOMStringMap }).dataset.saiText
    if (typeof v === 'string' && v.trim()) {
      // 若有选区范围，仍尝试用 range 相交文本（对 marker 可能无意义），优先返回 marker 文本
      if (range) {
        try {
          const t = getSelectedTextForBlock(b, range)
          if (t && t.trim()) return t
        } catch {}
      }
      return v.trim()
    }
  }
  if (range) {
    try {
      const t = getSelectedTextForBlock(b, range)
      if (t && t.trim()) return t
    } catch {}
  }
  return getBlockText(b)
}

/**
 * 将一批 block 通过限流队列逐个翻译（并发 QUEUE_CONCURRENCY）
 * 每个 block 独立卡片，类似沉浸式翻译的段落级双语
 */
async function translateBlocksQueue(
  blocks: HTMLElement[],
  getText: (b: HTMLElement) => string,
  explicitTarget?: string,
) {
  const items = blocks
    .map((b) => ({ anchor: b, text: getText(b).trim().slice(0, 4000) }))
    .filter((it) => it.text && isValidText(it.text))
  if (items.length === 0) return

  // 去重锚点
  const seen = new Set<HTMLElement>()
  const uniqItems = items.filter((it) => {
    if (seen.has(it.anchor)) return false
    seen.add(it.anchor)
    return true
  })
  if (uniqItems.length === 0) return

  if (uniqItems.length === 1) {
    const it = uniqItems[0]!
    await doTranslate(it.text, it.anchor, explicitTarget)
    return
  }

  // 并发限流：3 个 worker 抢队列，避免本地模型被瞬间打满
  let idx = 0
  const workers = Array.from({ length: Math.min(QUEUE_CONCURRENCY, uniqItems.length) }, async () => {
    while (true) {
      const cur = idx++
      if (cur >= uniqItems.length) break
      const item = uniqItems[cur]!
      try {
        await doTranslate(item.text, item.anchor, explicitTarget)
      } catch {
        // doTranslate 内部已通过 updateCard 展示错误，这里不抛
      }
    }
  })
  await Promise.all(workers)
}

function handleTranslateSelection() {
  const { text, range } = getSelectedText()

  // 1) 有选区：优先按 Range 内的块级元素拆分（已覆盖“选中父容器”时的 leaf 收集）
  if (range) {
    try {
      const blocks = getBlocksInRange(range)
      if (blocks.length > 1) {
        void translateBlocksQueue(blocks, (b) => getTextForQueuedBlock(b, range))
        return
      }
      if (blocks.length === 1) {
        const single = blocks[0]!
        const expanded = expandContainerToParagraphs(single)
        if (expanded.length > 1) {
          // 若 single 本身是多段落容器（如 <div><p/><p/></div>），按容器内子段过滤到与 range 相交的子集
          const filtered = expanded.filter((child: HTMLElement) => {
            try { return (range as Range).intersectsNode(child) } catch { return true }
          })
          const targets = filtered.length >= 2 ? filtered : expanded
          void translateBlocksQueue(targets, (b) => getTextForQueuedBlock(b, range))
          return
        }
        // 单块：若为部分选中则用相交文本，否则用整体 text
        const t = getTextForQueuedBlock(single, range) || text
        if (t && isValidText(t)) { void doTranslate(t, single); return }
      }
      // blocks 为空时，尝试用 anchor 展开（覆盖 range 为 selectNode(container) 的情况）
      const anchor = findBlockAnchor(range)
      if (anchor) {
        const expanded = expandContainerToParagraphs(anchor)
        if (expanded.length > 1) {
          const filtered = expanded.filter((child: HTMLElement) => {
            try { return (range as Range).intersectsNode(child) } catch { return true }
          })
          const targets = filtered.length >= 2 ? filtered : expanded
          void translateBlocksQueue(targets, (b) => getTextForQueuedBlock(b, range))
          return
        }
      }
    } catch {}
  }

  // 2) 有选区文本但未命中多块：锚点若为容器则展开为子段
  if (text && range) {
    let anchor: HTMLElement | null = null
    try { if (range) anchor = findBlockAnchor(range) } catch {}
    if (!anchor) anchor = getCurrentAnchor()
    if (anchor) {
      const expanded = expandContainerToParagraphs(anchor)
      if (expanded.length > 1) {
        void translateBlocksQueue(expanded, (b) => getTextForQueuedBlock(b, range))
        return
      }
      void doTranslate(text, anchor)
      return
    }
  }

  // 2b) 仅有 range（text 可能为空但 range 内有块，如三击选中父容器）
  if (range) {
    try {
      const blocks = getBlocksInRange(range)
      if (blocks.length > 0) {
        void translateBlocksQueue(blocks, (b) => getTextForQueuedBlock(b, range))
        return
      }
    } catch {}
  }

  // 3) 无选区：悬停锚点（沉浸式核心：hover 到父容器时展开为子段逐个译）
  const hoverAnchor = getCurrentAnchor()
  const hoverSentence = getHoverSentence()
  if (hoverAnchor) {
    const expanded = expandContainerToParagraphs(hoverAnchor)
    if (expanded.length > 1) {
      void translateBlocksQueue(expanded, (b) => getBlockText(b))
      return
    }
    if (hoverSentence && hoverSentence.trim().length >= 2) {
      void doTranslate(hoverSentence, hoverAnchor)
      return
    }
    const hoverText = (hoverAnchor.textContent || '').trim().slice(0, 4000)
    if (hoverText) { void doTranslate(hoverText, hoverAnchor); return }
  }

  // 4) 纯文本回退（如 input/textarea 选区无 range）
  if (text) {
    let anchor: HTMLElement | null = null
    try { if (range) anchor = findBlockAnchor(range) } catch {}
    if (anchor) {
      const expanded = expandContainerToParagraphs(anchor)
      if (expanded.length > 1) {
        void translateBlocksQueue(expanded, (b) => getBlockText(b))
        return
      }
    }
    void doTranslate(text, anchor)
    return
  }

  const body = document.body as unknown as HTMLElement
  void (async () => {
    try {
      await injectLoading(body)
      updateCard(body, 'empty', '未选中有效文本，请先选中或悬停目标段落', '提示', () => {})
      setTimeout(() => { try { (body.nextElementSibling as HTMLElement)?.remove() } catch {} }, 2000)
    } catch {}
  })()
}

export { handleTranslateSelection }
export function initShortcut() {
  void loadConfig()
  chrome.storage.onChanged.addListener((changes) => {
    if ('sai_translate_shortcut_key' in changes) {
      const v = changes['sai_translate_shortcut_key']?.newValue
      if (typeof v === 'string') shortcutKey = v
    }
    if ('sai_translate_target_lang' in changes) {
      const v = changes['sai_translate_target_lang']?.newValue
      if (typeof v === 'string') targetLang = v
    }
  })
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey === false && e.code === shortcutKey) {
      e.preventDefault()
      handleTranslateSelection()
    }
    if (e.key === 'Escape') window.dispatchEvent(new CustomEvent('sai:esc'))
  })
  window.addEventListener('sai:iconClick', (ev) => {
    const detail = (ev as CustomEvent).detail as { anchor: HTMLElement | null; sentence?: string } | undefined
    const anchor = detail?.anchor || getCurrentAnchor()
    if (!anchor) return
    // 图标点击同样遵循容器展开规则
    const expanded = expandContainerToParagraphs(anchor)
    if (expanded.length > 1) {
      void translateBlocksQueue(expanded, (b) => getBlockText(b))
      return
    }
    const sent = detail?.sentence || getHoverSentence()
    if (sent && sent.trim().length >= 2) { void doTranslate(sent, anchor); return }
    const txt = (anchor.textContent || '').trim().slice(0, 4000)
    if (txt) void doTranslate(txt, anchor)
  })
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (r: unknown) => void) => {
    if (!msg || typeof msg !== 'object') return undefined
    const m = msg as Record<string, unknown>
    const t = m['type'] as string | undefined
    if (t === 'SAI_TRIGGER_TRANSLATE' || t === 'SAI_COMMAND_TRANSLATE') {
      handleTranslateSelection()
      try { sendResponse({ ok: true }) } catch {}
      return true
    }
    if (t === 'SAI_CLOSE_ALL' || t === 'SAI_REMOVE_ALL' || t === 'close_all' || t === 'SAI_CLOSE_ALL_BG') {
      removeAll()
      try { sendResponse({ ok: true }) } catch {}
      return true
    }
    if (t === 'SAI_TOGGLE_INLINE' || t === 'toggle_inline' || t === 'toggle-inline') {
      removeAll()
      try { sendResponse({ ok: true }) } catch {}
      return true
    }
    return undefined
  })
  window.addEventListener('sai:esc', () => {
    const cur = getCurrentAnchor()
    if (cur && hasCard(cur)) removeCard(cur)
  })
}
