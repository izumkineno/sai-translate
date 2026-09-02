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
