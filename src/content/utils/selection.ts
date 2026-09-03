// Selection helpers — ported from docs/01 3.4 + sentence-level enhancement
export function getSelectedText(): { text: string; range: Range | null } {
  const sel = window.getSelection()
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    try {
      const range = sel.getRangeAt(0).cloneRange()
      const text = sel.toString().trim()
      if (text) return { text, range }
    } catch {}
  }
  const ae = document.activeElement as HTMLInputElement | null
  if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) {
    const { selectionStart, selectionEnd, value } = ae
    if (selectionStart != null && selectionEnd != null && selectionStart !== selectionEnd) {
      const text = value.slice(selectionStart, selectionEnd).trim()
      if (text) return { text, range: null }
    }
  }
  return { text: '', range: null }
}

export function isBlock(el: HTMLElement): boolean {
  const tag = el.tagName
  // 表格相关标签始终视为块，便于以 td/th 为翻译单元
  if (tag === 'TD' || tag === 'TH' || tag === 'TR' || tag === 'TABLE' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT' || tag === 'CAPTION' || tag === 'COLGROUP' || tag === 'COL') return true
  try {
    const d = getComputedStyle(el).display
    if (d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || (typeof d === 'string' && d.startsWith('table'))) return true
  } catch {}
  return tag === 'P' || /^H[1-6]$/.test(tag) || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN'
}

function shouldExcludeNode(el: Element, excludeSel: string): boolean {
  if (!excludeSel) return false
  try { return !!el.closest(excludeSel) } catch { return false }
}

export function findBlockAnchor(range: Range | null): HTMLElement | null {
  if (!range) return null
  const best = findBestBlockForRange(range, 'pre,code,[contenteditable]')
  if (best) return best
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement
  let el = node as HTMLElement | null
  while (el && !isBlock(el) && el !== document.body) el = el.parentElement
  if (el && el !== document.body) return el
  try {
    const sc = range.startContainer
    const p = sc.nodeType === Node.TEXT_NODE ? (sc.parentElement as HTMLElement) : (sc as HTMLElement)
    return p ?? null
  } catch { return null }
}

function scoreBlock(el: HTMLElement): number {
  const tag = el.tagName
  let tagScore = 10
  if (tag === 'P') tagScore = 0
  else if (/^H[1-6]$/.test(tag)) tagScore = 1
  else if (tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE') tagScore = 2
  else if (tag === 'TD' || tag === 'TH') tagScore = 2.5
  else if (tag === 'TR') tagScore = 4
  else if (tag === 'TABLE' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT' || tag === 'CAPTION') tagScore = 6
  else if (tag === 'DIV') tagScore = 5
  else tagScore = 8
  const txtLen = (el.textContent || '').trim().length
  let lenPenalty = 0
  // 表格单元格短文本常见，不应重罚
  if (tag === 'TD' || tag === 'TH') {
    if (txtLen < 2) lenPenalty = 20
    else if (txtLen > 800) lenPenalty = (txtLen - 800) / 100
    else if (txtLen > 300) lenPenalty = (txtLen - 300) / 200
  } else {
    if (txtLen < 15) lenPenalty = 20
    else if (txtLen > 800) lenPenalty = (txtLen - 800) / 100
    else if (txtLen > 300) lenPenalty = (txtLen - 300) / 200
  }
  const rect = el.getBoundingClientRect()
  const area = rect.width * rect.height
  const areaPenalty = area > 500000 ? 10 : area < 2000 ? 5 : 0
  return tagScore * 3 + lenPenalty + areaPenalty
}

export function findBestBlockForRange(range: Range, excludeSel = ''): HTMLElement | null {
  let node: Node | null = range.commonAncestorContainer
  if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement
  let el = node as HTMLElement | null
  const candidates: HTMLElement[] = []
  while (el && el !== document.body) {
    if (isBlock(el) && !shouldExcludeNode(el, excludeSel)) {
      const len = (el.textContent || '').trim().length
      const isCell = el.tagName === 'TD' || el.tagName === 'TH'
      const minLen = isCell ? 2 : 10
      if (len >= minLen && len <= 2000) candidates.push(el)
    }
    el = el.parentElement
  }
  if (candidates.length === 0) return null
  let best = candidates[0]!
  let bestScore = scoreBlock(best)
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreBlock(candidates[i]!)
    if (s < bestScore) { bestScore = s; best = candidates[i]! }
  }
  return best
}

export function findBestBlockAtPoint(x: number, y: number, excludeSel = ''): HTMLElement | null {
  const target = document.elementFromPoint(x, y) as HTMLElement | null
  if (!target) return null
  if (shouldExcludeNode(target, excludeSel)) return null
  let el: HTMLElement | null = target
  const candidates: HTMLElement[] = []
  while (el && el !== document.body) {
    if (isBlock(el) && !shouldExcludeNode(el, excludeSel)) {
      const rect = el.getBoundingClientRect()
      if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) {
        const len = (el.textContent || '').trim().length
        const isCell = el.tagName === 'TD' || el.tagName === 'TH'
        const minLen = isCell ? 2 : 10
        if (len >= minLen && len <= 3000) candidates.push(el)
      }
    }
    el = el.parentElement
  }
  if (candidates.length === 0) {
    let f = target
    while (f && f !== document.body && !isBlock(f)) f = f.parentElement as HTMLElement
    if (f && f !== document.body) return f
    return null
  }
  candidates.sort((a, b) => {
    const sa = scoreBlock(a), sb = scoreBlock(b)
    if (Math.abs(sa - sb) > 2) return sa - sb
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return ra.width * ra.height - rb.width * rb.height
  })
  return candidates[0]!
}

// --- Sentence segmentation ---

export type SentenceSeg = { text: string; start: number; end: number }

export function segmentSentences(text: string): SentenceSeg[] {
  if (!text.trim()) return []
  try {
    const SegCtor = (Intl as unknown as Record<string, unknown>)['Segmenter'] as unknown as new (locale: string, opts: unknown) => { segment: (s: string) => Iterable<{ segment: string; index: number }> }
    if (typeof SegCtor === 'function') {
      const segger = new SegCtor('zh', { granularity: 'sentence' })
      const out: SentenceSeg[] = []
      for (const { segment, index } of segger.segment(text)) {
        const s = segment
        if (!s.trim()) continue
        out.push({ text: s, start: index, end: index + s.length })
      }
      if (out.length > 0) return out
    }
  } catch {}
  const re = /[^。！？!?；;]+[。！？!?；;]?/g
  const out: SentenceSeg[] = []
  const matches = text.match(re)
  if (matches && matches.length > 1) {
    let idx = 0
    for (const seg of matches) {
      const s = seg
      if (!s.trim()) { idx += seg.length; continue }
      const start = text.indexOf(s, idx)
      const end = start + s.length
      out.push({ text: s, start, end })
      idx = end
    }
    if (out.length) return out
  }
  return [{ text, start: 0, end: text.length }]
}

function walkTextNodes(root: Node, cb: (node: Text, offset: number) => void) {
  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    cb(t, offset)
    offset += t.data.length
  }
}

export function getOffsetInBlock(block: HTMLElement, container: Node, caretOffset: number): number {
  let found = -1
  walkTextNodes(block, (node, start) => {
    if (node === container) found = start + caretOffset
  })
  if (found >= 0) return found
  return -1
}

export function rangeForOffsets(block: HTMLElement, start: number, end: number): Range | null {
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0
  walkTextNodes(block, (node, nodeStart) => {
    const len = node.data.length
    const nodeEnd = nodeStart + len
    if (!startNode && start >= nodeStart && start < nodeEnd) {
      startNode = node
      startOff = start - nodeStart
    }
    if (!endNode && end > nodeStart && end <= nodeEnd) {
      endNode = node
      endOff = end - nodeStart
    }
  })
  if (!startNode) return null
  if (!endNode) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null)
    let last: Text | null = null
    let n: Node | null
    while ((n = walker.nextNode())) last = n as Text
    if (!last) return null
    endNode = last
    endOff = last.data.length
  }
 try {
 const r = document.createRange()
 r.setStart(startNode as Text, Math.min(startOff, (startNode as Text).data.length))
 r.setEnd(endNode as Text, Math.min(endOff, (endNode as Text).data.length))
 return r
 } catch { return null }
}

export function getSentenceRangeAtPoint(x: number, y: number): { range: Range; block: HTMLElement; sentence: string; start: number; end: number } | null {
  let caretRange: Range | null = null
  try {
    const fn = (document as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint
    if (typeof fn === 'function') caretRange = fn.call(document, x, y)
    else {
      const posFn = (document as unknown as { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint
      if (typeof posFn === 'function') {
        const pos = posFn.call(document, x, y)
        if (pos) {
          const r = document.createRange()
          r.setStart(pos.offsetNode, pos.offset)
          r.collapse(true)
          caretRange = r
        }
      }
    }
  } catch {}
  if (!caretRange) return null
  let node: Node | null = caretRange.startContainer
  if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement
  let block = node as HTMLElement | null
  while (block && !isBlock(block) && block !== document.body) block = block.parentElement
  if (!block || block === document.body) return null
  const best = findBestBlockAtPoint(x, y)
  if (best) {
    const bRect = best.getBoundingClientRect()
    if (best.contains(caretRange.startContainer) || (x >= bRect.left && x <= bRect.right && y >= bRect.top && y <= bRect.bottom)) block = best
  }
  const blockText = block.textContent || ''
  if (!blockText.trim()) return null
  const offset = getOffsetInBlock(block, caretRange.startContainer, caretRange.startOffset)
  if (offset < 0) return null
  const segs = segmentSentences(blockText)
  const hit = segs.find((s) => offset >= s.start && offset < s.end) || segs.find((s) => offset >= s.start && offset <= s.end)
  if (!hit) return null
  const range = rangeForOffsets(block, hit.start, hit.end)
  if (!range) return null
  return { range, block, sentence: hit.text.trim(), start: hit.start, end: hit.end }
}

export function getBlocksInRange(range: Range, excludeSel = ''): HTMLElement[] {
 // Collect isBlock elements intersecting range, sorted by document order
 const common = range.commonAncestorContainer as Element
 let root: Element | null = null
 if (common.nodeType === Node.ELEMENT_NODE) root = common as Element
 else root = (common.parentElement as Element) || document.body
 // If root is not block container and common is large (body/article), traverse from body limited
 const candidateRoot = root.closest ? (root.closest('article,main,#content,.content') as Element | null) || root : root
 // fallback to document.body if root is body and range covers many blocks, we still want to find blocks inside body that intersect
 const searchRoot = candidateRoot === document.body && range.toString().length > 200 ? document.body : candidateRoot
 const blocks: HTMLElement[] = []
 const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_ELEMENT, {
 acceptNode(node) {
 const el = node as HTMLElement
 if (!isBlock(el)) return NodeFilter.FILTER_SKIP
 const len = (el.textContent || '').trim().length
 const isCell = el.tagName === 'TD' || el.tagName === 'TH'
 const minLen = isCell ? 2 : 10
 if (len < minLen) return NodeFilter.FILTER_SKIP
 // intersects?
 try { if (!range.intersectsNode(el)) return NodeFilter.FILTER_SKIP } catch { return NodeFilter.FILTER_SKIP }
 return NodeFilter.FILTER_ACCEPT
 },
 })
 let n: Node | null
 while ((n = walker.nextNode())) blocks.push(n as HTMLElement)
 // If nothing found but range directly inside a block, fallback to findBestBlockForRange
 if (blocks.length === 0) {
 const best = findBestBlockForRange(range, excludeSel)
 if (best) blocks.push(best)
 }
 // De-duplicate nested: if a block contains another block in list, keep only leaf-most blocks
 // e.g., <div><p>a</p><p>b</p></div> where div also isBlock and intersects, we want p's, not div
 const filtered: HTMLElement[] = []
 for (const b of blocks) {
 const isAncestorOfOther = blocks.some((other) => other !== b && b.contains(other))
 if (!isAncestorOfOther) filtered.push(b)
 }
 // Sort by document order (walker already gives order, but keep)
 filtered.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1)
 return filtered
}

export function getSelectedTextForBlock(block: HTMLElement, range: Range): string {
 try {
 const blockRange = document.createRange()
 blockRange.selectNodeContents(block)
 // Check intersects
 if (!range.intersectsNode(block)) return ''
 // Compute intersection
 let startContainer: Node = range.startContainer
 let startOffset: number = range.startOffset
 let endContainer: Node = range.endContainer
 let endOffset: number = range.endOffset
 // If range starts before block, clamp to block start
 if (range.compareBoundaryPoints(Range.START_TO_START, blockRange) < 0) {
 startContainer = blockRange.startContainer
 startOffset = blockRange.startOffset
 }
 // If range ends after block, clamp to block end
 if (range.compareBoundaryPoints(Range.END_TO_END, blockRange) > 0) {
 endContainer = blockRange.endContainer
 endOffset = blockRange.endOffset
 }
 const inter = document.createRange()
 inter.setStart(startContainer, startOffset)
 inter.setEnd(endContainer, endOffset)
 const txt = inter.toString().trim()
 return txt
 } catch { return '' }
}

export function getVisibleParagraphBlocks(excludeSel = ''): HTMLElement[] {
 const all = Array.from(document.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td'))
 const res: HTMLElement[] = []
 for (const el of all) {
 if (shouldExcludeNode(el, excludeSel)) continue
 const txt = (el.textContent || '').trim()
 if (txt.length < 15 || txt.length > 2000) continue
 const rect = el.getBoundingClientRect()
 if (rect.width < 50 || rect.height < 10) continue
 // visible check
 const style = getComputedStyle(el)
 if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
 res.push(el)
 }
 // Fallback to any isBlock with reasonable text if no p found (e.g., medium style divs)
 if (res.length < 3) {
 const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
 acceptNode(node) {
 const el = node as HTMLElement
 if (!isBlock(el)) return NodeFilter.FILTER_SKIP
 if (shouldExcludeNode(el, excludeSel)) return NodeFilter.FILTER_REJECT
 const len = (el.textContent || '').trim().length
 if (len < 20 || len > 2000) return NodeFilter.FILTER_SKIP
 return NodeFilter.FILTER_ACCEPT
 },
 })
 const extra: HTMLElement[] = []
 let n: Node | null
 while ((n = walker.nextNode())) extra.push(n as HTMLElement)
 // dedup
 for (const e of extra) if (!res.includes(e) && !res.some((r) => r.contains(e) || e.contains(r))) res.push(e)
 }
 res.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1)
 return res
}

// --- Container -> paragraph queue (沉浸式风格) ---

export function getBlockText(el: HTMLElement): string {
  if ((el as HTMLElement & { dataset: DOMStringMap }).dataset?.saiUnwrapped === '1') {
    const v = (el as HTMLElement & { dataset: DOMStringMap }).dataset.saiText
    if (typeof v === 'string' && v) return v
  }
  return (el.textContent || '').trim()
}

function collectUnwrappedSegments(container: HTMLElement, excludeSel: string, leafs: HTMLElement[]): Array<{ nodes: Node[]; text: string }> {
  const segments: Array<{ nodes: Node[]; text: string }> = []
  const isInsideLeaf = (node: Node): boolean => {
    for (const l of leafs) if (l.contains(node)) return true
    return false
  }
  const childNodes = Array.from(container.childNodes)
  let segmentNodes: Node[] = []
  let segmentText = ''
  const flush = () => {
    if (segmentNodes.length === 0) return
    const text = segmentText.trim()
    if (text.length < 10 || !isValidText(text)) {
      segmentNodes = []
      segmentText = ''
      return
    }
    segments.push({ nodes: [...segmentNodes], text })
    segmentNodes = []
    segmentText = ''
  }
  for (const node of childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.dataset?.saiUnwrapped === '1') {
        flush()
        continue
      }
      if (shouldExcludeNode(el, excludeSel)) {
        flush()
        continue
      }
      if (el.tagName === 'BR') {
        flush()
        continue
      }
      if (isBlock(el)) {
        flush()
        continue
      }
      if (isInsideLeaf(node)) continue
      const txt = (el.textContent || '').trim()
      if (!txt) continue
      segmentNodes.push(el)
      segmentText += ' ' + txt
    } else if (node.nodeType === Node.TEXT_NODE) {
      if (isInsideLeaf(node)) continue
      const txt = (node.textContent || '').trim()
      if (!txt) continue
      segmentNodes.push(node)
      segmentText += ' ' + txt
    }
  }
  flush()
  return segments
}

function ensureMarkersForSegments(segments: Array<{ nodes: Node[]; text: string }>): HTMLElement[] {
  const markers: HTMLElement[] = []
  for (const seg of segments) {
    const last = seg.nodes[seg.nodes.length - 1]!
    let next = last.nextSibling as HTMLElement | null
    while (next && next.nodeType === Node.TEXT_NODE && !(next.textContent || '').trim()) {
      next = next.nextSibling as HTMLElement | null
    }
    if (next && (next as HTMLElement).dataset?.saiUnwrapped === '1') {
      ;(next as HTMLElement).dataset.saiText = seg.text
      markers.push(next as HTMLElement)
    } else {
      const marker = document.createElement('span')
      marker.dataset.saiUnwrapped = '1'
      marker.dataset.saiText = seg.text
      marker.style.display = 'none'
      marker.setAttribute('data-sai-unwrapped', '1')
      const parent = last.parentNode
      if (parent) {
        try {
          parent.insertBefore(marker, last.nextSibling)
          markers.push(marker)
        } catch {}
      }
    }
  }
  return markers
}

/**
 * 检测 container 是否为包含多个段落的父容器。
 * 增强：对未被 p/span 包裹的裸文本（bare text）通过 marker 机制补齐，保证无包裹文本也能逐段队列翻译。
 */
export function expandContainerToParagraphs(container: HTMLElement, excludeSel = 'pre,code,[contenteditable],script,style'): HTMLElement[] {
  if (!container || !(container instanceof HTMLElement)) return []
  const tag = container.tagName
  if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || /^H[1-6]$/.test(tag) || tag === 'TD' || tag === 'TH' || tag === 'CODE') {
    return []
  }
  try {
    if (!container.querySelector) return []
  } catch { return [] }
  // 1) 收集块级叶节点（原有逻辑，放宽 early return 便于与裸文本合并）
  const candidates: HTMLElement[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement
      if (el === container) return NodeFilter.FILTER_SKIP
      // marker 本身不计入候选
      if ((el as HTMLElement).dataset?.saiUnwrapped === '1') return NodeFilter.FILTER_REJECT
      if (!isBlock(el)) return NodeFilter.FILTER_SKIP
      if (shouldExcludeNode(el, excludeSel)) return NodeFilter.FILTER_REJECT
      const len = getBlockText(el).length
      const isCell = el.tagName === 'TD' || el.tagName === 'TH'
      const minLen = isCell ? 2 : 10
      if (len < minLen) return NodeFilter.FILTER_SKIP
      try {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_SKIP
        const rect = el.getBoundingClientRect()
        if (rect.width !== 0 || rect.height !== 0) {
          if (rect.width < 20 || rect.height < 8) return NodeFilter.FILTER_SKIP
        }
      } catch {}
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let n: Node | null
  while ((n = walker.nextNode())) candidates.push(n as HTMLElement)
  let leafs: HTMLElement[] = []
  if (candidates.length >= 1) {
    const tmp: HTMLElement[] = []
    for (const b of candidates) {
      const isAncestor = candidates.some((other) => other !== b && b.contains(other))
      if (!isAncestor) tmp.push(b)
    }
    leafs = tmp
  }
  // 2) 收集裸文本段落（无 p/span 包裹的文本），先收集段再决定是否落盘 marker，避免单段孤儿
  const segments = collectUnwrappedSegments(container, excludeSel, leafs)
  if (leafs.length + segments.length < 2) return []
  const unwrapped = ensureMarkersForSegments(segments)
  // 3) 合并并按文档序排序
  const combined: HTMLElement[] = [...leafs, ...unwrapped]
  if (combined.length < 2) {
    return []
  }
  // 去重
  const uniq: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  for (const el of combined) if (!seen.has(el)) { seen.add(el); uniq.push(el) }
  if (uniq.length < 2) return []
  if (uniq.length > 50) return uniq.slice(0, 50)
  // 覆盖率与平均长度检查（对 marker 取 dataset 文本）
  const containerTextLen = (container.textContent || '').trim().length
  const sumLen = uniq.reduce((sum, el) => sum + getBlockText(el).length, 0)
  if (containerTextLen > 0) {
    const coverage = sumLen / containerTextLen
    if (coverage < 0.5 && uniq.length < 4) return []
    const avgLen = sumLen / uniq.length
    if (avgLen < 8) return []
  }
  return uniq
}

export function isMultiParagraphContainer(el: HTMLElement): boolean {
  return expandContainerToParagraphs(el).length >= 2
}

export function resolveTranslateTargets(anchor: HTMLElement, excludeSel = 'pre,code,[contenteditable],script,style'): HTMLElement[] {
  const expanded = expandContainerToParagraphs(anchor, excludeSel)
  if (expanded.length >= 2) return expanded
  return [anchor]
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function isValidText(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return false
  if (/^https?:\/\/\S+$/i.test(t)) return false
  if (/^\W+$/.test(t)) return false
  return true
}

// --- Image helpers for Vision translation — hybrid base64 / URL  ---
// 策略（可由设置强制）：auto=小图同源 base64，大图/跨域 URL；url=强制 URL；base64=强制 base64（失败回退 URL）。
// 对应 OPENAI_COMPAT_API.md §3.1：image_url.url 支持 data:* 与 http(s) 远端混用。
export type ImagePayload = { url: string; mode: 'data' | 'url' }
export type ImagePayloadMode = 'auto' | 'url' | 'base64'

// --- 内存 payload 缓存：同 URL+尺寸+模式短时复用，避免重复 canvas 编码/后台拉取 ---
// key 含 naturalWidth/Height：同一 URL 换断点（srcset/currentSrc 切换）不串味。
// LRU + 总字节上限 + 5min TTL，会话级 Map，导航即清零（content script 生命周期）。
type PayloadCacheEntry = { payload: ImagePayload; bytes: number; time: number }
const PAYLOAD_CACHE = new Map<string, PayloadCacheEntry>()
const PAYLOAD_CACHE_MAX_ENTRIES = 30
const PAYLOAD_CACHE_MAX_BYTES = 30 * 1024 * 1024
const PAYLOAD_CACHE_TTL_MS = 5 * 60 * 1000
let payloadCacheBytes = 0
function payloadBytesOf(p: ImagePayload): number {
  if (p.mode !== 'data') return 0
  try {
    const b64 = p.url.split(',')[1] || ''
    return Math.ceil(b64.length * 0.75)
  } catch { return 0 }
}
function payloadCacheKey(src: string, w: number, h: number, mode: ImagePayloadMode): string {
  return `${mode}|${w}x${h}|${src}`
}
function payloadCacheGet(key: string): ImagePayload | null {
  const e = PAYLOAD_CACHE.get(key)
  if (!e) return null
  if (Date.now() - e.time > PAYLOAD_CACHE_TTL_MS) {
    PAYLOAD_CACHE.delete(key)
    payloadCacheBytes = Math.max(0, payloadCacheBytes - e.bytes)
    return null
  }
  // LRU 刷新
  PAYLOAD_CACHE.delete(key)
  PAYLOAD_CACHE.set(key, e)
  return e.payload
}
function payloadCacheSet(key: string, payload: ImagePayload): void {
  if (payload.mode !== 'data') return // URL 模式不占内存，只缓存 base64 实物
  const bytes = payloadBytesOf(payload)
  if (bytes <= 0 || bytes > 10 * 1024 * 1024) return
  const prev = PAYLOAD_CACHE.get(key)
  if (prev) {
    PAYLOAD_CACHE.delete(key)
    payloadCacheBytes = Math.max(0, payloadCacheBytes - prev.bytes)
  }
  while ((PAYLOAD_CACHE.size >= PAYLOAD_CACHE_MAX_ENTRIES || payloadCacheBytes + bytes > PAYLOAD_CACHE_MAX_BYTES) && PAYLOAD_CACHE.size > 0) {
    const oldest = PAYLOAD_CACHE.keys().next()
    if (oldest.done) break
    const k = oldest.value as string
    const old = PAYLOAD_CACHE.get(k)
    PAYLOAD_CACHE.delete(k)
    if (old) payloadCacheBytes = Math.max(0, payloadCacheBytes - old.bytes)
  }
  PAYLOAD_CACHE.set(key, { payload, bytes, time: Date.now() })
  payloadCacheBytes += bytes
}
export function isCrossOriginUrl(src: string): boolean {
   try {
    const u = new URL(src, location.href)
    return u.origin !== location.origin
  } catch {
    return false
  }
}

export function isLargeImage(img: HTMLImageElement): boolean {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w <= 0 || h <= 0) return false
  const pixels = w * h
  if (pixels > 1_000_000) return true
  if (Math.max(w, h) > 1600) return true
  return false
}

// 内部：canvas 编码为 dataURL（不含 background fetch 兜底，供上层决策）
async function canvasEncodeForPayload(img: HTMLImageElement): Promise<string | null> {
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null
  let w = img.naturalWidth
  let h = img.naturalHeight
  const MAX_SIDE = 8192
  const MAX_PIXELS = 33_000_000
  let scale = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)))
  if (!isFinite(scale) || scale <= 0) scale = 1
  if (scale < 1) {
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const src = (img.currentSrc || img.src || '').toLowerCase()
  const mime = src.endsWith('.webp') ? 'image/webp' : src.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const quality = mime === 'image/png' ? undefined : 0.92
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(img, 0, 0, w, h)
  } catch {
    return null
  }
  try {
    return quality !== undefined ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime)
  } catch {
    return null
  }
}

export async function getImagePayloadForTranslation(img: HTMLImageElement, mode: ImagePayloadMode = 'auto'): Promise<ImagePayload | null> {
  if (!img || !(img instanceof HTMLImageElement)) return null
  if (!isTranslatableImage(img)) return null
  const rawSrc = (img.currentSrc || img.src || '').trim()
  if (!rawSrc) return null
  const low = rawSrc.toLowerCase()
  // 已是 data: 直接返回（不受模式影响，不进内存缓存）
  if (low.startsWith('data:image/')) {
    return { url: rawSrc, mode: 'data' }
  }
  if (low.startsWith('blob:')) {
    // blob 仅能 canvas 转（同页已解码位图，零网络）；服务端不支持 blob:
    // 可见时再试帧缓冲截图兜底，仍零图片宿主请求
    try {
      const data = await canvasEncodeForPayload(img)
      if (data) return { url: data, mode: 'data' }
    } catch {}
    try {
      const shot = await captureScreenshotPayload(img)
      if (shot) return shot
    } catch {}
    return null
  }
  // http(s) 远端
  try {
    const u = new URL(rawSrc, location.href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  } catch {
    return null
  }
  const normalized: ImagePayloadMode = mode === 'url' || mode === 'base64' ? mode : 'auto'
  if (normalized === 'url') {
    // 强制 URL：直接走远端，交服务端 reqwest 拉取（零扩展流量）
    return { url: rawSrc, mode: 'url' }
  }
  // 内存缓存：同 URL+自然尺寸+模式短时复用
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const cacheKey = payloadCacheKey(rawSrc, nw, nh, normalized)
  const hit = payloadCacheGet(cacheKey)
  if (hit) return hit
  const keep = (p: ImagePayload | null): ImagePayload | null => {
    if (p && p.mode === 'data') payloadCacheSet(cacheKey, p)
    return p
  }
  const sizeOk = (url: string): boolean => {
    const b64 = url.split(',')[1] || ''
    return Math.ceil(b64.length * 0.75) <= 10 * 1024 * 1024 && b64.length <= 14_000_000
  }
  if (normalized === 'base64') {
    // 强制 base64：内存位图 -> 后台 force-cache -> 帧缓冲截图 -> 回退 URL
    try {
      const data = await canvasEncodeForPayload(img)
      if (data && sizeOk(data)) return keep({ url: data, mode: 'data' })
    } catch {}
    try {
      const fetched = await fetchImageViaBackground(rawSrc)
      if (fetched && sizeOk(fetched)) return keep({ url: fetched, mode: 'data' })
      if (fetched) return keep({ url: fetched, mode: 'data' })
    } catch {}
    try {
      const shot = await captureScreenshotPayload(img)
      if (shot) return keep(shot)
    } catch {}
    // 彻底失败回退 URL，避免无法翻译
    return { url: rawSrc, mode: 'url' }
  }
  // auto：大图直接 URL（保原分辨率、省内存/流量）；小图走内存链，跨域也不再直返 URL
  if (isLargeImage(img)) {
    return { url: rawSrc, mode: 'url' }
  }
  try {
    const data = await canvasEncodeForPayload(img)
    if (data && sizeOk(data)) return keep({ url: data, mode: 'data' })
  } catch {}
  try {
    const fetched = await fetchImageViaBackground(rawSrc)
    if (fetched && sizeOk(fetched)) return keep({ url: fetched, mode: 'data' })
    if (fetched) return keep({ url: fetched, mode: 'data' })
  } catch {}
  try {
    const shot = await captureScreenshotPayload(img)
    if (shot) return keep(shot)
  } catch {}
  return { url: rawSrc, mode: 'url' }
}

export function isTranslatableImage(img: HTMLImageElement): boolean {
  if (!img || img.tagName !== 'IMG') return false
  const src = (img.src || '').trim()
  if (!src) return false
  if (src.includes('chrome.google.com')) return false
  const low = src.toLowerCase()
  if (low.startsWith('data:image/')) {
    // data URL allowed
  } else if (low.startsWith('blob:')) {
    // blob: 允许由 canvasEncodeForPayload / getImagePayload 处理，不在此拦截
  } else {
    try {
      const url = new URL(src, location.href)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    } catch {
      return false
    }
  }
  if (!img.complete) return false
  if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return false
  return true
}

async function fetchImageViaBackground(src: string): Promise<string | null> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SAI_FETCH_IMAGE', url: src, referrer: location.href }) as unknown as { ok?: boolean; dataUrl?: string }
    if (resp && resp.ok && typeof resp.dataUrl === 'string' && resp.dataUrl.startsWith('data:image/')) return resp.dataUrl
  } catch {}
  return null
}

// --- 合成器帧缓冲兜底：截可见区再按 rect 裁剪，不请求图片宿主，无 CORS/403 ---
// 全屏截图由 background(SAI_CAPTURE) 透传，裁剪在 content 做（SW 无 DOM）。
// 精度为渲染分辨率，适合小图 OCR 兜底；大图仍优先 URL 保原分辨率。
export async function captureScreenshotPayload(img: HTMLImageElement): Promise<ImagePayload | null> {
  try {
    if (!img || !(img instanceof HTMLImageElement)) return null
    const rect = img.getBoundingClientRect()
    if (!rect || rect.width < 2 || rect.height < 2) return null
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null
    const resp = await chrome.runtime.sendMessage({ type: 'SAI_CAPTURE' }) as unknown as { ok?: boolean; dataUrl?: string }
    if (!resp || !resp.ok || typeof resp.dataUrl !== 'string' || !resp.dataUrl.startsWith('data:image/')) return null
    const blob = await (await fetch(resp.dataUrl)).blob()
    if (!blob || blob.size <= 0 || blob.size > 15 * 1024 * 1024) return null
    let bitmap: ImageBitmap | null = null
    try { bitmap = await createImageBitmap(blob) } catch { return null }
    if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) return null
    try {
      const scaleX = bitmap.width / Math.max(1, window.innerWidth)
      const scaleY = bitmap.height / Math.max(1, window.innerHeight)
      const sx = Math.max(0, Math.floor(rect.left * scaleX))
      const sy = Math.max(0, Math.floor(rect.top * scaleY))
      const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * scaleX)))
      const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * scaleY)))
      if (sw < 2 || sh < 2) { try { bitmap.close() } catch {} ; return null }
      const maxOut = 1600
      const outScale = Math.min(1, maxOut / Math.max(sw, sh))
      const dw = Math.max(1, Math.round(sw * outScale))
      const dh = Math.max(1, Math.round(sh * outScale))
      const canvas = document.createElement('canvas')
      canvas.width = dw
      canvas.height = dh
      const ctx = canvas.getContext('2d')
      if (!ctx) { try { bitmap.close() } catch {} ; return null }
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
      try { bitmap.close() } catch {}
      let out: string | null = null
      try { out = canvas.toDataURL('image/jpeg', 0.85) } catch { return null }
      if (!out) return null
      const b64 = out.split(',')[1] || ''
      if (Math.ceil(b64.length * 0.75) > 10 * 1024 * 1024 || b64.length > 14_000_000) return null
      return { url: out, mode: 'data' }
    } catch { try { bitmap.close() } catch {} ; return null }
  } catch { return null }
}

export function findBestImageAtPoint(x: number, y: number, excludeSel = ''): HTMLImageElement | null {
  // Check elementsFromPoint/elementFromPoint branch
  const checkCandidate = (el: Element | null): HTMLImageElement | null => {
    if (!el) return null
    if (excludeSel && shouldExcludeNode(el, excludeSel)) return null
    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement
      if (isTranslatableImage(img) && !shouldExcludeNode(img, excludeSel)) return img
    }
    try {
      const closest = (el as HTMLElement).closest?.('img') as HTMLImageElement | null
      if (closest && isTranslatableImage(closest) && !shouldExcludeNode(closest, excludeSel)) return closest
    } catch {}
    return null
  }
  try {
    const top = document.elementFromPoint(x, y) as Element | null
    const hit = checkCandidate(top)
    if (hit) return hit
  } catch {}
  // fallback: elementsFromPoint to handle stacking/overlays
  try {
    // elementsFromPoint not yet in all lib.dom definitions — use feature detection
    const docForHitTest = document as unknown as Document & {
      elementsFromPoint?: (x: number, y: number) => Element[]
    } // typed hit-test extension
    const fn = docForHitTest.elementsFromPoint
    if (typeof fn === 'function') {
      const els = fn.call(document, x, y)
      for (const el of els) {
        const hit = checkCandidate(el)
        if (hit) return hit
      }
    }
  } catch {}
  return null
}

export function findBestImageForRange(range: Range, excludeSel = ''): HTMLImageElement | null {
  try {
    let node: Node | null = range.commonAncestorContainer
    let root: Element | null = null
    if (node.nodeType === Node.ELEMENT_NODE) root = node as Element
    else root = (node.parentElement as Element | null) ?? document.body
    if (!root) root = document.body
    let candidateRoot: Element = root
    try {
      const c = (root as HTMLElement).closest?.('article,main,#content,.content') as Element | null
      if (c) candidateRoot = c
    } catch {}
    const searchRoot: Element =
      candidateRoot === document.body && range.toString().length > 200 ? document.body : candidateRoot

    const candidates: HTMLImageElement[] = []
    // searchRoot itself could be an <img>
    if (searchRoot.tagName === 'IMG') {
      const img = searchRoot as HTMLImageElement
      if (isTranslatableImage(img) && !shouldExcludeNode(img, excludeSel)) {
        try {
          if (range.intersectsNode(img)) candidates.push(img)
        } catch {}
      }
    }
    const walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const el = node as HTMLElement
        if (el.tagName !== 'IMG') return NodeFilter.FILTER_SKIP
        if (excludeSel && shouldExcludeNode(el, excludeSel)) return NodeFilter.FILTER_SKIP
        const img = el as HTMLImageElement
        if (!isTranslatableImage(img)) return NodeFilter.FILTER_SKIP
        try {
          if (!range.intersectsNode(img)) return NodeFilter.FILTER_SKIP
        } catch {
          return NodeFilter.FILTER_SKIP
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let n: Node | null
    while ((n = walker.nextNode())) candidates.push(n as HTMLImageElement)
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    return candidates[0]!
  } catch {
    return null
  }
}

export async function getImageDataURLForTranslation(img: HTMLImageElement): Promise<string | null> {
  // Wait for load if not complete (up to 3s)
  if (!img.complete) {
    const raced = await Promise.race([
      new Promise<boolean>((resolve) => {
        let settled = false
        const cleanup = () => {
          img.removeEventListener('load', onLoad)
          img.removeEventListener('error', onError)
        }
        const onLoad = () => {
          if (settled) return
          settled = true
          cleanup()
          resolve(true)
        }
        const onError = () => {
          if (settled) return
          settled = true
          cleanup()
          resolve(false)
        }
        img.addEventListener('load', onLoad, { once: true })
        img.addEventListener('error', onError, { once: true })
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ])
    void raced
    if (!img.complete) return null
  }
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null

  let w = img.naturalWidth
  let h = img.naturalHeight
  if (w <= 0 || h <= 0) return null
  const MAX_SIDE = 8192
  const MAX_PIXELS = 33_000_000
  let scale = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)))
  if (!isFinite(scale) || scale <= 0) scale = 1
  if (scale < 1) {
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const getOutputMime = (img: HTMLImageElement): { mime: string; quality?: number } => {
    const src = (img.currentSrc || img.src || '').toLowerCase()
    if (src.endsWith('.webp')) return { mime: 'image/webp', quality: 0.92 }
    if (src.endsWith('.png')) return { mime: 'image/png' }
    if (src.endsWith('.jpg') || src.endsWith('.jpeg')) return { mime: 'image/jpeg', quality: 0.92 }
    // pixiv 原图多为 jpg，默认 jpeg 更省；png 透明图会退化但仍可译（白底）
    // 为避免 429k jpg 被 png 膨胀为 3.2M，此处默认 jpeg
    return { mime: 'image/jpeg', quality: 0.92 }
  }
  const outMime = getOutputMime(img)
  const drawAndEncode = (mime: string, quality?: number): string | null => {
    const c = canvas.getContext('2d')
    if (!c) return null
    try {
      // jpeg 不支持透明，先铺白底避免黑底
      if (mime === 'image/jpeg') {
        c.fillStyle = '#ffffff'
        c.fillRect(0, 0, w, h)
      }
      c.drawImage(img, 0, 0, w, h)
    } catch {
      return null
    }
    try {
      return quality !== undefined ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime)
    } catch {
      return null
    }
  }
  let dataUrl: string | null = drawAndEncode(outMime.mime, outMime.quality)
  if (!dataUrl) {
    // canvas 污点（跨域 pximg.net 等）——后台 force-cache 优先命中已加载缓存，不重访宿主
    const fetched = await fetchImageViaBackground(img.src)
    if (fetched) dataUrl = fetched
  }
  if (!dataUrl) {
    // 仍失败且可见——帧缓冲截图兜底，零图片宿主请求，无 CORS/403
    try {
      const shot = await captureScreenshotPayload(img)
      if (shot && shot.mode === 'data') dataUrl = shot.url
    } catch {}
    if (!dataUrl) return null
  }
  if (!dataUrl) return null
  const getBytes = (url: string): { b64Len: number; bytes: number } => {
    const parts = url.split(',')
    const b64 = parts[1] ?? ''
    // approximate bytes, ignoring padding
    const bytes = Math.ceil(b64.length * 0.75)
    return { b64Len: b64.length, bytes }
  }

  let { b64Len, bytes } = getBytes(dataUrl)
  let retries = 0
  while ((bytes > 10 * 1024 * 1024 || b64Len > 14_000_000) && retries < 3) {
    retries++
    w = Math.max(1, Math.floor(w * 0.9))
    h = Math.max(1, Math.floor(h * 0.9))
    canvas.width = w
    canvas.height = h
    // need fresh ctx after resize (same canvas element, but re-get)
    // ctx remains valid but clear
    dataUrl = drawAndEncode(outMime.mime, outMime.quality)
    if (!dataUrl) return null
    const s = getBytes(dataUrl)
    b64Len = s.b64Len
    bytes = s.bytes
  }
  // final check: if still over limits after retries, return null to signal too large
  if (bytes > 10 * 1024 * 1024 || b64Len > 14_000_000) return null
  return dataUrl
}
