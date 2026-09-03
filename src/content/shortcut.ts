import { getCurrentAnchor } from './hover'
import * as HoverNS from './hover'
import { injectLoading, removeAll, hasCard, removeCard, hasTranslatedCard, updateCard, showBelowLoading, commitSerialized, failBelow, showBelowText, isClonableAnchor, isCellAnchor } from './inject'
import {
  expandContainerToParagraphs,
  findBlockAnchor,
  getBlockText,
  getBlocksInRange,
  getSelectedText,
  getSelectedTextForBlock,
  isValidText,
} from './utils/selection'
import * as SelectionNS from './utils/selection'
import type { SerializedBlock } from './utils/selection'

type TranslateReq = { type: 'SAI_TRANSLATE'; kind?: 'text' | 'image'; text: string; imageDataUrl?: string; imageUrl?: string; target?: string; requestId: string; html?: boolean }
type TranslateRes = { type: 'SAI_TRANSLATE_RESULT'; requestId: string; ok: boolean; translated?: string; error?: string; model?: string; annotatedDataUrl?: string }
type ImagePayloadMode = 'auto' | 'url' | 'base64'

let shortcutKey = 'KeyQ'
let targetLang = '中文'
let imageMode: ImagePayloadMode = 'auto'
let displayMode: 'card' | 'immersive' = 'card'
let selectionEnabled = true
let selectionAuto = false
let selectionShortcut = true
let selectionKey = 'KeyR'
let selectionMinLength = 2

function parseImageMode(v: unknown): ImagePayloadMode {
  return v === 'url' || v === 'base64' || v === 'auto' ? v : 'auto'
}

async function loadConfig() {
  try {
    const raw = await chrome.storage.local.get(['sai_translate_shortcut_key', 'sai_translate_target_lang', 'sai_translate_image_mode', 'sai_translate_display_mode', 'sai_selection_enabled', 'sai_selection_auto_translate', 'sai_selection_shortcut', 'sai_selection_min_length'])
    const sk = raw['sai_translate_shortcut_key']
    if (typeof sk === 'string' && sk) shortcutKey = sk
    const tl = raw['sai_translate_target_lang']
    if (typeof tl === 'string' && tl) targetLang = tl
    const im = raw['sai_translate_image_mode']
    imageMode = parseImageMode(im)
    const dm = raw['sai_translate_display_mode']
    displayMode = dm === 'immersive' ? 'immersive' : 'card'
    const se = raw['sai_selection_enabled']
    if (typeof se === 'boolean') selectionEnabled = se
    const sa = raw['sai_selection_auto_translate']
    if (typeof sa === 'boolean') selectionAuto = sa
    const ss = raw['sai_selection_shortcut']
    if (typeof ss === 'boolean') selectionShortcut = ss
    const skey = raw['sai_selection_key']
    if (typeof skey === 'string' && skey) selectionKey = skey
    const ml = raw['sai_selection_min_length']
    if (typeof ml === 'number' && Number.isFinite(ml)) selectionMinLength = Math.max(1, Math.min(50, Math.round(ml)))
  } catch {}
}
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------- image helpers: resolve dynamic exports with fallback ----------
function resolveImageHelpers() {
  const ns = SelectionNS as unknown as Record<string, unknown>
  return {
    isTranslatableImage: ns['isTranslatableImage'] as ((img: HTMLImageElement) => boolean) | undefined,
    findBestImageForRange: ns['findBestImageForRange'] as ((range: Range, exclude?: string) => HTMLImageElement | null) | undefined,
    findBestImageAtPoint: ns['findBestImageAtPoint'] as ((x: number, y: number, exclude?: string) => HTMLImageElement | null) | undefined,
    getImageDataURLForTranslation: ns['getImageDataURLForTranslation'] as ((img: HTMLImageElement) => Promise<string | null>) | undefined,
    getImagePayloadForTranslation: ns['getImagePayloadForTranslation'] as ((img: HTMLImageElement, mode?: ImagePayloadMode) => Promise<{ url: string; mode: 'data' | 'url' } | null>) | undefined,
    captureScreenshotPayload: ns['captureScreenshotPayload'] as ((img: HTMLImageElement) => Promise<{ url: string; mode: 'data' | 'url' } | null>) | undefined,
    isCrossOriginUrl: ns['isCrossOriginUrl'] as ((src: string) => boolean) | undefined,
    isLargeImage: ns['isLargeImage'] as ((img: HTMLImageElement) => boolean) | undefined,
  }
}

// 帧缓冲截图兜底（content 侧）：优先复用 selection 导出的裁剪实现，缺失才本地裁剪。
// 零图片宿主请求，无 CORS/403；仅可见小图有意义，大图/不可见返回 null 交上层回退 URL。
async function getScreenshotFallback(img: HTMLImageElement): Promise<string | null> {
  try {
    const h = resolveImageHelpers()
    if (h.captureScreenshotPayload) {
      const p = await h.captureScreenshotPayload(img)
      if (p && p.mode === 'data' && typeof p.url === 'string' && p.url.startsWith('data:image/')) return p.url
    }
  } catch {}
  try {
    if (!img || !(img instanceof HTMLImageElement)) return null
    const rect = img.getBoundingClientRect()
    if (!rect || rect.width < 2 || rect.height < 2) return null
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null
    const resp = await chrome.runtime.sendMessage({ type: 'SAI_CAPTURE' }) as unknown as { ok?: boolean; dataUrl?: string }
    if (!resp || !resp.ok || typeof resp.dataUrl !== 'string' || !resp.dataUrl.startsWith('data:image/')) return null
    const blob = await (await fetch(resp.dataUrl)).blob()
    if (!blob || blob.size <= 0 || blob.size > 15 * 1024 * 1024) return null
    const bitmap = await createImageBitmap(blob).catch(() => null)
    if (!bitmap || bitmap.width <= 0 || bitmap.height <= 0) return null
    try {
      const scaleX = bitmap.width / Math.max(1, window.innerWidth)
      const scaleY = bitmap.height / Math.max(1, window.innerHeight)
      const sx = Math.max(0, Math.floor(rect.left * scaleX))
      const sy = Math.max(0, Math.floor(rect.top * scaleY))
      const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * scaleX)))
      const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * scaleY)))
      if (sw < 2 || sh < 2) { try { bitmap.close() } catch {} ; return null }
      const outScale = Math.min(1, 1600 / Math.max(sw, sh))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sw * outScale))
      canvas.height = Math.max(1, Math.round(sh * outScale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { try { bitmap.close() } catch {} ; return null }
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      try { bitmap.close() } catch {}
      const out = canvas.toDataURL('image/jpeg', 0.85)
      const b64 = out.split(',')[1] || ''
      if (Math.ceil(b64.length * 0.75) > 10 * 1024 * 1024) return null
      return out
    } catch { try { bitmap.close() } catch {} ; return null }
  } catch { return null }
}

async function getPayloadForImage(img: HTMLImageElement): Promise<string | null> {
  // 首选：走 selection 的新 payload 接口（带模式）
  try {
    const h = resolveImageHelpers()
    if (h.getImagePayloadForTranslation) {
      try {
        const p = await (h.getImagePayloadForTranslation as unknown as (img: HTMLImageElement, mode: ImagePayloadMode) => Promise<{ url: string; mode: 'data' | 'url' } | null>)(img, imageMode)
        if (p && typeof p.url === 'string' && p.url) return p.url
      } catch {
        // 兼容旧签名（无 mode 参数）
        const p2 = await (h.getImagePayloadForTranslation as unknown as (img: HTMLImageElement) => Promise<{ url: string; mode: 'data' | 'url' } | null>)(img)
        if (p2 && typeof p2.url === 'string' && p2.url) return p2.url
      }
    }
  } catch {}
  // fallback — 按设置模式镜像 selection 逻辑，不依赖新导出
  // 顺序与 selection 对齐：内存位图 -> 后台 force-cache(含) -> 帧缓冲截图 -> URL
  try {
    const rawSrc = (img.currentSrc || img.src || '').trim()
    if (!rawSrc) return null
    const low = rawSrc.toLowerCase()
    if (low.startsWith('data:image/')) return rawSrc
    if (low.startsWith('blob:')) {
      const h2 = resolveImageHelpers()
      const getter = h2.getImageDataURLForTranslation || getImageDataURLFallback
      const d = await getter(img)
      if (d) return d
      const shot = await getScreenshotFallback(img)
      if (shot) return shot
      return null
    }
    if (!/^https?:\/\//i.test(rawSrc)) return null
    // 强制模式
    if (imageMode === 'url') return rawSrc
    if (imageMode === 'base64') {
      const h3 = resolveImageHelpers()
      const getter = h3.getImageDataURLForTranslation || getImageDataURLFallback
      const data = await getter(img)
      if (data) return data
      const shot = await getScreenshotFallback(img)
      if (shot) return shot
      return rawSrc
    }
    // auto：大图直接 URL 保分辨率；小图走内存链（跨域也不直返 URL，避免服务端 403）
    const isLarge = img.naturalWidth * img.naturalHeight > 1_000_000 || Math.max(img.naturalWidth, img.naturalHeight) > 1600
    if (isLarge) return rawSrc
    const h4 = resolveImageHelpers()
    const getter2 = h4.getImageDataURLForTranslation || getImageDataURLFallback
    const data = await getter2(img)
    if (data) return data
    const shot = await getScreenshotFallback(img)
    if (shot) return shot
    return rawSrc
  } catch {}
  return null
}

function getCurrentImageAnchor(): HTMLImageElement | null {
  const hoverAny = HoverNS as unknown as Record<string, unknown>
  const fn = hoverAny['getCurrentImageAnchor']
  if (typeof fn === 'function') {
    try {
      const v = (fn as () => unknown)()
      if (v instanceof HTMLImageElement) return v
    } catch {}
  }
  const anchor = getCurrentAnchor()
  if (anchor instanceof HTMLImageElement) return anchor
  return null
}

function getExcludeSel(): string {
  try {
    const fn = (HoverNS as unknown as Record<string, unknown>)['getHoverConfig'] as (() => unknown) | undefined
    if (typeof fn === 'function') {
      const cfg = fn() as Record<string, unknown>
      const sel = cfg['excludeSelectors']
      if (typeof sel === 'string') return sel
    }
  } catch {}
  return ''
}

function isTranslatableImageFallback(img: HTMLImageElement): boolean {
  try {
    if (!(img instanceof HTMLImageElement)) return false
    if (!img.src) return false
    if (img.src.startsWith('data:')) return true
    if (img.src.startsWith('blob:')) return false
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return false
    try {
      const u = new URL(img.src, location.href)
      if (u.protocol === 'data:') return true
      return u.origin === location.origin
    } catch {
      return false
    }
  } catch {
    return false
  }
}

async function getImageDataURLFallback(img: HTMLImageElement): Promise<string | null> {
  try {
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return null
    const helpers = resolveImageHelpers()
    const check = helpers.isTranslatableImage || isTranslatableImageFallback
    if (!check(img)) return null
    const maxSide = 8192
    const maxPixels = 33_000_000
    let w = img.naturalWidth
    let h = img.naturalHeight
    let scale = 1
    if (Math.max(w, h) > maxSide) scale = Math.min(scale, maxSide / Math.max(w, h))
    if (w * h > maxPixels) scale = Math.min(scale, Math.sqrt(maxPixels / (w * h)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let dataUrl: string
    try {
      dataUrl = canvas.toDataURL('image/png')
    } catch {
      return null
    }
    try {
      const b64 = dataUrl.split(',')[1] || ''
      const bytes = Math.ceil(b64.length * 3 / 4)
      if (bytes > 10 * 1024 * 1024) {
        let curScale = scale * 0.8
        for (let i = 0; i < 3; i++) {
          canvas.width = Math.max(1, Math.round(w * curScale))
          canvas.height = Math.max(1, Math.round(h * curScale))
          const c2 = canvas.getContext('2d')
          if (!c2) break
          c2.drawImage(img, 0, 0, canvas.width, canvas.height)
          try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          } catch {
            return null
          }
          const b2 = dataUrl.split(',')[1] || ''
          const by2 = Math.ceil(b2.length * 3 / 4)
          if (by2 <= 10 * 1024 * 1024) break
          curScale *= 0.7
        }
        const finalB64 = dataUrl.split(',')[1] || ''
        if (Math.ceil(finalB64.length * 3 / 4) > 10 * 1024 * 1024) return null
      }
    } catch {}
    return dataUrl
  } catch {
    return null
  }
}

function getImageErrorMessage(img: HTMLImageElement, getterReturnedNull: boolean): string {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return '无法获取原图 (未加载)'
  const helpers = resolveImageHelpers()
  const check = helpers.isTranslatableImage || isTranslatableImageFallback
  let isTranslatable = false
  try { isTranslatable = check(img) } catch { isTranslatable = false }
  if (!isTranslatable) {
    try {
      const u = new URL(img.src, location.href)
      if (u.origin !== location.origin && !img.src.startsWith('data:')) return '无法获取原图 (CORS)'
      if (img.src.startsWith('blob:')) return '无法获取原图 (CORS)'
    } catch {}
    // Check size as alternative for large
    if (img.naturalWidth > 8192 || img.naturalHeight > 8192 || img.naturalWidth * img.naturalHeight > 33_000_000) return '图片过大'
    return '无法获取原图 (CORS/未加载)'
  }
  if (getterReturnedNull) {
    if (img.naturalWidth > 8192 || img.naturalHeight > 8192 || img.naturalWidth * img.naturalHeight > 33_000_000) return '图片过大'
    return '无法获取原图 (CORS/未加载)'
  }
  return '无法获取原图 (CORS/未加载)'
}

function collectImagesInRange(range: Range): HTMLImageElement[] {
  const excludeSel = getExcludeSel()
  const result: HTMLImageElement[] = []
  try {
    const all = document.querySelectorAll('img')
    for (const el of Array.from(all)) {
      if (!(el instanceof HTMLImageElement)) continue
      if (excludeSel) {
        try { if (el.closest(excludeSel)) continue } catch {}
      }
      try {
        if (range.intersectsNode(el)) result.push(el)
      } catch {}
    }
  } catch {}
  // dedup preserve order
  const seen = new Set<HTMLImageElement>()
  const uniq: HTMLImageElement[] = []
  for (const img of result) {
    if (!seen.has(img)) {
      seen.add(img)
      uniq.push(img)
    }
  }
  return uniq
}

// SAI_TRANSLATE 发收（doTranslate 与分段共用）
function sendTranslateReq(req: TranslateReq): Promise<TranslateRes> {
  return new Promise<TranslateRes>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(req, (res: unknown) => {
        const err = chrome.runtime.lastError
        if (err) { reject(new Error(err.message)); return }
        if (!res || typeof res !== 'object') { reject(new Error('无响应')); return }
        if (!('type' in res) || res.type !== 'SAI_TRANSLATE_RESULT') { reject(new Error('响应类型错误')); return }
        resolve(res as unknown as TranslateRes)
      })
    } catch (e) { reject(e) }
  })
}

// 占位符整块翻译：序列化一次请求，还原后落盘；还原失败回退纯文本块
//（替代逐 Text 节点多请求：省请求、保语序、<a> 等特殊标记由映射同步）
async function doTranslateSerialized(anchor: HTMLElement, ser: SerializedBlock, explicitTarget?: string, opts?: { force?: boolean }) {
  if (!anchor.isConnected) return
  // 已有译文重复触发 → 转关闭（卡片自带×/重译按钮不受影响：错误态无标记，重试直通）
  if (!opts?.force && hasTranslatedCard(anchor)) { removeCard(anchor); return }
  const target = explicitTarget || targetLang
  showBelowLoading(anchor)
  const req: TranslateReq = { type: 'SAI_TRANSLATE', kind: 'text', text: ser.payload, target, requestId: genId(), html: true }
  let translated: string | null = null
  try {
    const res = await sendTranslateReq(req)
    if (res.ok && typeof res.translated === 'string' && res.translated.trim()) translated = res.translated
  } catch {}
  if (!anchor.isConnected) return
  if (!translated) {
    failBelow(anchor, '翻译失败', () => { void doTranslateSerializedRetry(anchor, explicitTarget) })
    return
  }
  const { restoreSerialized } = SelectionNS
  const html = restoreSerialized(translated, ser.map, ser.wrapCount)
  if (html && commitSerialized(anchor, html)) return
  // 还原失败（弱模型删占位符/丢标签是常态）：纯文本单请求回退为块级卡，聊胜于无
  try {
    const plain = getBlockText(anchor).trim().slice(0, 4000)
    if (plain && isValidText(plain)) {
      const res2 = await sendTranslateReq({ type: 'SAI_TRANSLATE', kind: 'text', text: plain, target, requestId: genId() })
      if (!anchor.isConnected) return
      if (res2.ok && typeof res2.translated === 'string' && res2.translated.trim()) {
        showBelowText(anchor, res2.translated)
        return
      }
    }
  } catch {}
  if (!anchor.isConnected) return
  failBelow(anchor, '翻译失败', () => { void doTranslateSerializedRetry(anchor, explicitTarget) })
}
// 重试统一走 doTranslate（重新序列化，原文可能已变化）
async function doTranslateSerializedRetry(anchor: HTMLElement, explicitTarget?: string) {
  try {
    const cell = isCellAnchor(anchor)
    const ser = SelectionNS.serializeAnchor(anchor, cell ? { excludeNestedTables: true } : undefined)
    if (ser) { await doTranslateSerialized(anchor, ser, explicitTarget); return }
  } catch {}
  void doTranslate(getBlockText(anchor), anchor, explicitTarget)
}

async function doTranslate(text: string, anchor: HTMLElement | null, explicitTarget?: string, opts?: { force?: boolean; card?: boolean }) {
  const normalized = text.trim()
  // 划词强制翻译窗口（card）：跳过沉浸式分支 + 绘制阶段同样锁定卡片形态，不受全局 displayMode 影响
  const cardOnly = !!opts?.card
  const cardOpt = cardOnly ? { card: true as const } : undefined
  const forceMode = cardOnly ? 'card' as const : undefined
  if (!isValidText(normalized)) {
    if (anchor) {
      const host = await injectLoading(anchor, forceMode)
      void host
      updateCard(anchor, 'error', '未选中有效文本', '错误', () => { void doTranslate(text, anchor, explicitTarget, cardOpt) }, undefined, forceMode)
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
  // 已有译文重复触发 → 转关闭；成功卡片的重译按钮显式 force 直通，避免把“重译”变成“关闭”
  if (!opts?.force && hasTranslatedCard(targetAnchor)) { removeCard(targetAnchor); return }
  if (!cardOnly && displayMode === 'immersive' && targetAnchor && targetAnchor.tagName !== 'IMG' && targetAnchor.tagName !== 'BODY' && targetAnchor.tagName !== 'HTML' && isClonableAnchor(targetAnchor)) {
    const ser = SelectionNS.serializeAnchor(targetAnchor)
    if (ser) {
      await doTranslateSerialized(targetAnchor, ser, explicitTarget)
      return
    }
  }
  // 沉浸式 + 单元格：同上，嵌套表子树不进外层载荷（含嵌套表的外层格扇出到内格队列）
  if (!cardOnly && displayMode === 'immersive' && targetAnchor && isCellAnchor(targetAnchor)) {
    try {
      if (targetAnchor.querySelector('table')) {
        // 直接调用不经过 doTranslate，避免外层格重复扇出；深层嵌套逐层收敛
        const outerSer = SelectionNS.serializeAnchor(targetAnchor, { excludeNestedTables: true })
        if (outerSer) await doTranslateSerialized(targetAnchor, outerSer, explicitTarget)
        const inners = Array.from(targetAnchor.querySelectorAll('td,th')) as HTMLElement[]
        const valid = inners.filter((c) => { try { const t = getBlockText(c); return t && isValidText(t) } catch { return false } })
        if (valid.length >= 1) await translateBlocksQueue(valid.slice(0, 50), (b) => getBlockText(b), explicitTarget)
        return
      }
    } catch {}
    const ser = SelectionNS.serializeAnchor(targetAnchor, { excludeNestedTables: true })
    if (ser) {
      await doTranslateSerialized(targetAnchor, ser, explicitTarget)
      return
    }
  }
  // 表格结构锚点（TABLE/TR/section）永远不单译：展开为内层单元格队列，span 落位才合法
  if (targetAnchor && SelectionNS.isTableStructural(targetAnchor)) {
    try {
      const expanded = expandContainerToParagraphs(targetAnchor)
      if (expanded.length >= 1) {
        await translateBlocksQueue(expanded, (b) => getBlockText(b), explicitTarget, cardOpt)
        return
      }
      const scope = (() => {
        try {
          if (targetAnchor.querySelectorAll('td,th').length > 0) return targetAnchor
        } catch {}
        return SelectionNS.outermostTable(targetAnchor) ?? targetAnchor
      })()
      const cells = Array.from(scope.querySelectorAll('td,th')) as HTMLElement[]
      const valid = cells.filter((c) => getBlockText(c) && isValidText(getBlockText(c)))
      if (valid.length >= 1) {
        await translateBlocksQueue(valid.slice(0, 50), (b) => getBlockText(b).trim().slice(0, 4000), explicitTarget, cardOpt)
        return
      }
    } catch {}
  }
  try {
    await injectLoading(targetAnchor, forceMode)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '注入失败'
    updateCard(targetAnchor, 'error', msg, '错误', () => { void doTranslate(text, targetAnchor, explicitTarget, cardOpt) }, undefined, forceMode)
    return
  }
  const req: TranslateReq = {
    type: 'SAI_TRANSLATE',
    kind: 'text',
    text: normalized.slice(0, 4000),
    target: explicitTarget || targetLang,
    requestId: genId(),
  }
  const send = () => sendTranslateReq(req)
  try {
    const res = await send()
    if (res.ok) {
      const translated = typeof res.translated === 'string' ? res.translated : ''
      updateCard(targetAnchor, 'success', translated, `${res.model || 'LLM'} · ${req.target}`, () => { void doTranslate(text, targetAnchor, explicitTarget, { force: true, ...cardOpt }) }, undefined, forceMode)
    } else {
      const err = typeof res.error === 'string' ? res.error : '翻译失败'
      updateCard(targetAnchor, 'error', err, '错误', () => { void doTranslate(text, targetAnchor, explicitTarget, cardOpt) }, undefined, forceMode)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '请求失败'
    updateCard(targetAnchor, 'error', msg.slice(0, 200), '错误', () => { void doTranslate(text, targetAnchor, explicitTarget, cardOpt) }, undefined, forceMode)
  }
}

async function doTranslateImage(imageUrl: string, anchor: HTMLElement, explicitTarget?: string) {
  let targetAnchor: HTMLElement = anchor
  if (!targetAnchor) targetAnchor = document.body as unknown as HTMLElement
  try {
    await injectLoading(targetAnchor)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '注入失败'
    updateCard(targetAnchor, 'error', msg, '错误', () => { void doTranslateImage(imageUrl, targetAnchor, explicitTarget) })
    return
  }
  const isData = imageUrl.trim().toLowerCase().startsWith('data:')
  const req: TranslateReq = {
    type: 'SAI_TRANSLATE',
    kind: 'image',
    text: imageUrl,
    imageUrl: imageUrl,
    ...(isData ? { imageDataUrl: imageUrl } : {}),
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
      const annotated = typeof res.annotatedDataUrl === 'string' ? res.annotatedDataUrl : undefined
      updateCard(targetAnchor, 'success', translated, `${res.model || 'LLM'} · ${req.target}`, () => { void doTranslateImage(imageUrl, targetAnchor, explicitTarget) }, annotated)
    } else {
      const err = typeof res.error === 'string' ? res.error : '翻译失败'
      updateCard(targetAnchor, 'error', err, '错误', () => { void doTranslateImage(imageUrl, targetAnchor, explicitTarget) })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '请求失败'
    updateCard(targetAnchor, 'error', msg.slice(0, 300), '错误', () => { void doTranslateImage(imageUrl, targetAnchor, explicitTarget) })
  }
}

// ---------- 队列：沉浸式逐段翻译 ----------

const QUEUE_CONCURRENCY = 3
function getTextForQueuedBlock(b: HTMLElement, range: Range | null): string {
  // 核心修复：含 <a>/<em>/inline 的 <p> 等块，任何部分命中即整段翻译
  // 原逻辑用 range 相交文本，导致 <em>/<a> 边界处只取到片段，表现"只有全选才完整"
  const inlineRich = b.querySelector?.('a, em, i, b, strong, span, code, u, s, mark, small, cite, q, abbr')
  if (inlineRich) {
    const full = getBlockText(b).trim()
    if (full && isValidText(full)) return full
  }
  if (b.tagName === 'P' || b.tagName === 'LI' || /^H[1-6]$/.test(b.tagName) || b.tagName === 'BLOCKQUOTE') {
    const degree = (b.childNodes.length > 1) ? 1 : 0
    if (degree) {
      const full = getBlockText(b).trim()
      if (full && full.length > 80) return full
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
  opts?: { card?: boolean },
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
    await doTranslate(it.text, it.anchor, explicitTarget, opts)
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
        await doTranslate(item.text, item.anchor, explicitTarget, opts)
      } catch {
        // doTranslate 内部已通过 updateCard 展示错误，这里不抛
      }
    }
  })
  await Promise.all(workers)
}

async function translateImagesQueue(imgs: HTMLImageElement[], explicitTarget?: string) {
  const seen = new Set<HTMLImageElement>()
  const uniq = imgs.filter((img) => {
    if (seen.has(img)) return false
    seen.add(img)
    return true
  })
  if (uniq.length === 0) return
  // single fast path still via queue for error isolation uniform
  let idx = 0
  const workers = Array.from({ length: Math.min(QUEUE_CONCURRENCY, uniq.length) }, async () => {
    while (true) {
      const cur = idx++
      if (cur >= uniq.length) break
      const img = uniq[cur]!
      try {
        const payload = await getPayloadForImage(img)
        if (!payload) {
          const msg = getImageErrorMessage(img, true)
          try {
            await injectLoading(img)
          } catch (e) {
            const imsg = e instanceof Error ? e.message : '注入失败'
            try { updateCard(img, 'error', imsg, '错误', () => { void translateImagesQueue([img], explicitTarget) }) } catch {}
            continue
          }
          updateCard(img, 'error', msg, '错误', () => {
            void (async () => {
              const retryPayload = await getPayloadForImage(img)
              if (!retryPayload) {
                const rmsg = getImageErrorMessage(img, true)
                updateCard(img, 'error', rmsg, '错误', () => { void translateImagesQueue([img], explicitTarget) })
              } else {
                void doTranslateImage(retryPayload, img, explicitTarget)
              }
            })()
          })
          continue
        }
        await doTranslateImage(payload, img, explicitTarget)
      } catch {
        // isolated, continue to next
      }
    }
  })
  await Promise.all(workers)
}
// 独立选词键入口：仅翻译选区，无选区直接忽略（不回退悬浮锚点）
function handleTranslateSelectionOnly() {
  if (!selectionEnabled) return
  try {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
  } catch { return }
  handleTranslateSelection()
}

function handleTranslateSelection() {
  const { text, range } = getSelectedText()
  // 划词总开关：有选区但已关闭 → 直接返回（悬浮锚点路径不受影响）
  if (!selectionEnabled) {
    try {
      const sel = window.getSelection()
      if ((sel && !sel.isCollapsed) || (text && text.trim())) return
    } catch {}
  }

  // 0) 图片分支优先：Range 覆盖的图（多图并发 3，单图直译）
  if (range) {
    try {
      const imgsInRange = collectImagesInRange(range)
      if (imgsInRange.length > 0) {
        if (imgsInRange.length > 1) {
          void translateImagesQueue(imgsInRange)
          return
        }
        // single image in range
        const singleImg = imgsInRange[0]!
        void (async () => {
          const payload = await getPayloadForImage(singleImg)
          if (!payload) {
            const msg = getImageErrorMessage(singleImg, true)
            try {
              await injectLoading(singleImg)
              updateCard(singleImg, 'error', msg, '错误', () => {
                void (async () => {
                  const retryPayload = await getPayloadForImage(singleImg)
                  if (!retryPayload) {
                    const rmsg = getImageErrorMessage(singleImg, true)
                    updateCard(singleImg, 'error', rmsg, '错误', () => { void (async () => { const p = await getPayloadForImage(singleImg); if(!p) updateCard(singleImg,'error',getImageErrorMessage(singleImg,true),'错误',()=>{}); else void doTranslateImage(p,singleImg)})() })
                  } else {
                    void doTranslateImage(retryPayload, singleImg)
                  }
                })()
              })
            } catch (e) {
              const imsg = e instanceof Error ? e.message : msg
              try { updateCard(singleImg, 'error', imsg, '错误', () => {}) } catch {}
            }
            return
          }
          await doTranslateImage(payload, singleImg)
        })()
        return
      }
      // fallback to helper's best image if collect missed (e.g., figure wrapping)
      const helpers = resolveImageHelpers()
      if (helpers.findBestImageForRange) {
        try {
          const best = helpers.findBestImageForRange(range, getExcludeSel())
          if (best) {
            void (async () => {
              const payload = await getPayloadForImage(best)
              if (!payload) {
                const msg = getImageErrorMessage(best, true)
                try {
                  await injectLoading(best)
                  updateCard(best, 'error', msg, '错误', () => {
                    void (async () => {
                      const retryPayload = await getPayloadForImage(best)
                      if (!retryPayload) updateCard(best, 'error', getImageErrorMessage(best, true), '错误', () => {})
                      else void doTranslateImage(retryPayload, best)
                    })()
                  })
                } catch {}
                return
              }
              await doTranslateImage(payload, best)
            })()
            return
          }
        } catch {}
      }
    } catch {}
  }

  // 0b) Hover image 优先（无选区或选区无图）：悬停图直译
  {
    const hoverImg = getCurrentImageAnchor()
    if (hoverImg) {
      void (async () => {
        const payload = await getPayloadForImage(hoverImg)
        if (!payload) {
          const msg = getImageErrorMessage(hoverImg, true)
          try {
            await injectLoading(hoverImg)
            updateCard(hoverImg, 'error', msg, '错误', () => {
              void (async () => {
                const retryPayload = await getPayloadForImage(hoverImg)
                if (!retryPayload) updateCard(hoverImg, 'error', getImageErrorMessage(hoverImg, true), '错误', () => {})
                else void doTranslateImage(retryPayload, hoverImg)
              })()
            })
          } catch (e) {
            const imsg = e instanceof Error ? e.message : msg
            try { updateCard(hoverImg, 'error', imsg, '错误', () => {}) } catch {}
          }
          return
        }
        await doTranslateImage(payload, hoverImg)
      })()
      return
    }
  }

  // 1) 有选区：优先按 Range 内的块级元素拆分（已覆盖“选中父容器”时的 leaf 收集）
  if (range) {
    try {
      const blocks = getBlocksInRange(range)
      if (blocks.length > 1) {
        void translateBlocksQueue(blocks, (b) => getTextForQueuedBlock(b, range), undefined, { card: true })
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
          void translateBlocksQueue(targets, (b) => getTextForQueuedBlock(b, range), undefined, { card: true })
          return
        }
        // 单块：含内联标记的段一律整段翻译，修复"<a>/<em> 边界截断"现象
        const t = getTextForQueuedBlock(single, range) || text
        // 若仍为片段且段内有 <a>/<em>，强制用全段兜底
        let finalT = t
        if (single.querySelector?.('a,em') && t && getBlockText(single).length > t.length + 20) {
          const full = getBlockText(single).trim()
          if (isValidText(full)) finalT = full
        }
        if (finalT && isValidText(finalT)) { void doTranslate(finalT, single, undefined, { card: true }); return }
        if (expanded.length > 1) {
          const filtered = expanded.filter((child: HTMLElement) => {
            try { return (range as Range).intersectsNode(child) } catch { return true }
          })
          const targets = filtered.length >= 2 ? filtered : expanded
          void translateBlocksQueue(targets, (b) => getTextForQueuedBlock(b, range), undefined, { card: true })
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
        void translateBlocksQueue(expanded, (b) => getTextForQueuedBlock(b, range), undefined, { card: true })
        return
      }
      void doTranslate(text, anchor, undefined, { card: true })
      return
    }
  }

  // 2b) 仅有 range（text 可能为空但 range 内有块，如三击选中父容器）
  if (range) {
    try {
      const blocks = getBlocksInRange(range)
      if (blocks.length > 0) {
        void translateBlocksQueue(blocks, (b) => getTextForQueuedBlock(b, range), undefined, { card: true })
        return
      }
    } catch {}
  }

  // 3) 无选区：悬停锚点（沉浸式核心：hover 到父容器时展开为子段逐个译）
  // 已取消"自动截一句"逻辑：hover 整段翻译，修复"hover一段却只译一句"问题
  // 视觉上的句级高亮(getSentenceRangeAtPoint)仍保留，仅作预选提示，不影响翻译文本
  const hoverAnchor = getCurrentAnchor()
  if (hoverAnchor) {
    const expanded = expandContainerToParagraphs(hoverAnchor)
    if (expanded.length > 1) {
      void translateBlocksQueue(expanded, (b) => getBlockText(b))
      return
    }
    const hoverText = getBlockText(hoverAnchor).trim().slice(0, 4000) || (hoverAnchor.textContent || '').trim().slice(0, 4000)
    if (hoverText && isValidText(hoverText)) { void doTranslate(hoverText, hoverAnchor); return }
  }
  // 4) 纯文本回退（如 input/textarea 选区无 range）
  if (text) {
    let anchor: HTMLElement | null = null
    try { if (range) anchor = findBlockAnchor(range) } catch {}
    if (anchor) {
      const expanded = expandContainerToParagraphs(anchor)
      if (expanded.length > 1) {
        void translateBlocksQueue(expanded, (b) => getBlockText(b), undefined, { card: true })
        return
      }
    }
    void doTranslate(text, anchor, undefined, { card: true })
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
    if ('sai_translate_image_mode' in changes) {
      const v = changes['sai_translate_image_mode']?.newValue
      imageMode = parseImageMode(v)
    }
    if ('sai_translate_display_mode' in changes) {
      const v = changes['sai_translate_display_mode']?.newValue
      displayMode = v === 'immersive' ? 'immersive' : 'card'
    }
    if ('sai_selection_enabled' in changes) {
      const v = changes['sai_selection_enabled']?.newValue
      if (typeof v === 'boolean') selectionEnabled = v
    }
    if ('sai_selection_auto_translate' in changes) {
      const v = changes['sai_selection_auto_translate']?.newValue
      if (typeof v === 'boolean') selectionAuto = v
    }
    if ('sai_selection_shortcut' in changes) {
      const v = changes['sai_selection_shortcut']?.newValue
      if (typeof v === 'boolean') selectionShortcut = v
    }
    if ('sai_selection_key' in changes) {
      const v = changes['sai_selection_key']?.newValue
      if (typeof v === 'string' && v) selectionKey = v
    }
    if ('sai_selection_min_length' in changes) {
      const v = changes['sai_selection_min_length']?.newValue
      if (typeof v === 'number' && Number.isFinite(v)) selectionMinLength = Math.max(1, Math.min(50, Math.round(v)))
    }
  })
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey === false && e.code === shortcutKey) {
      // 快捷键触发关闭且存在有效选区 → 不拦截、不翻译（悬浮锚点路径同样不走，避免歧义）
      try {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().trim() && !selectionShortcut) return
      } catch {}
      e.preventDefault()
      handleTranslateSelection()
    }
    // 独立选词键：仅翻译选区；与主页内键同键时让主逻辑处理，避免一次按键触发两次 toggle
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey === false && e.code === selectionKey && e.code !== shortcutKey) {
      if (!selectionEnabled || !selectionShortcut) return
      e.preventDefault()
      handleTranslateSelectionOnly()
    }
    if (e.key === 'Escape') window.dispatchEvent(new CustomEvent('sai:esc'))
  })
  // 划词自动翻译：mouseup 后防抖触发，跳过输入区与自家卡片
  let selTimer: number | null = null
  window.addEventListener('mouseup', (e) => {
    if (!selectionAuto || !selectionEnabled) return
    try {
      const t = e.target as Element | null
      if (t && t.closest && t.closest('[data-sai],[data-sai-immersive],[data-sai-inplace],input,textarea,[contenteditable="true"]')) return
    } catch {}
    if (selTimer !== null) window.clearTimeout(selTimer)
    selTimer = window.setTimeout(() => {
      selTimer = null
      try {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
        const s = sel.toString().trim()
        if (s.length < selectionMinLength || !isValidText(s)) return
        handleTranslateSelection()
      } catch {}
    }, 450)
  })
  window.addEventListener('sai:iconClick', (ev) => {
    const detail = (ev as CustomEvent).detail as { anchor: HTMLElement | null; sentence?: string } | undefined
    const anchor = detail?.anchor || getCurrentAnchor()
    if (!anchor) return
    // If anchor is an image, route to image translation
    if (anchor instanceof HTMLImageElement) {
      void (async () => {
        const payload = await getPayloadForImage(anchor)
        if (!payload) {
          const msg = getImageErrorMessage(anchor, true)
          try {
            await injectLoading(anchor)
            updateCard(anchor, 'error', msg, '错误', () => {
              void (async () => {
                const retryPayload = await getPayloadForImage(anchor)
                if (!retryPayload) updateCard(anchor, 'error', getImageErrorMessage(anchor, true), '错误', () => {})
                else void doTranslateImage(retryPayload, anchor)
              })()
            })
          } catch {}
          return
        }
        await doTranslateImage(payload, anchor)
      })()
      return
    }
    // also check if currentImageAnchor exists and anchor contains image? Fallback: try hover image anchor
    const hoverImg = getCurrentImageAnchor()
    if (hoverImg && hoverImg !== anchor) {
      // Prefer hover image if it differs and anchor is container of that image? Use hoverImg
      // But icon click's anchor is already the hovered element; if hoverImg is image and anchor is its container, use image
      // Check if anchor contains hoverImg
      try {
        if (anchor.contains(hoverImg)) {
          void (async () => {
            const payload = await getPayloadForImage(hoverImg)
            if (!payload) {
              const msg = getImageErrorMessage(hoverImg, true)
              try {
                await injectLoading(hoverImg)
                updateCard(hoverImg, 'error', msg, '错误', () => {
                  void (async () => {
                    const retryPayload = await getPayloadForImage(hoverImg)
                    if (!retryPayload) updateCard(hoverImg, 'error', getImageErrorMessage(hoverImg, true), '错误', () => {})
                    else void doTranslateImage(retryPayload, hoverImg)
                  })()
                })
              } catch {}
              return
            }
            await doTranslateImage(payload, hoverImg)
          })()
          return
        }
      } catch {}
    }
    // 图标点击同样遵循容器展开规则，取消"自动一句"：一律整段
    const expanded = expandContainerToParagraphs(anchor)
    if (expanded.length > 1) {
      void translateBlocksQueue(expanded, (b) => getBlockText(b))
      return
    }
    const txt = getBlockText(anchor).trim().slice(0, 4000) || (anchor.textContent || '').trim().slice(0, 4000)
    if (txt && isValidText(txt)) void doTranslate(txt, anchor)
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
    if (t === 'SAI_TRIGGER_SELECTION') {
      handleTranslateSelectionOnly()
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
    const imgCur = getCurrentImageAnchor()
    const target = imgCur || cur
    if (target && hasCard(target)) removeCard(target)
    else {
      // fallback: if no hover target, try closing last card via remove? Use cur
      if (cur && hasCard(cur)) removeCard(cur)
    }
  })
}
