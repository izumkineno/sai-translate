// MV3 service worker — handles commands + SAI_TRANSLATE
// No DOM access; only chrome.* + shared/translate

import { callLLM, callVisionLLM, logFetchFailed, sanitizeHeaders, type TranslateReq, type TranslateRes } from '../shared/translate'
const MODELS_KEY = 'sai_translate_models'
const ACTIVE_KEY = 'sai_translate_active_model'
const TARGET_LANG_KEY = 'sai_translate_target_lang'
const DRAFT_KEY = 'sai_translate_draft'

const TEXT_LIMIT = 4000
const TIMEOUT_MS = 20_000
const TIMEOUT_TEXT = TIMEOUT_MS
const TIMEOUT_IMAGE = 40_000

type StoredSource = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  activeModel: string
  createdAt: number
}

type DraftStore = {
  input?: string
  output?: string
  target?: string
}

// Map<requestId, AbortController> for concurrency + timeout
const pending = new Map<string, AbortController>()

function mapError(err: unknown, ctx?: { kind?: string; baseUrl?: string }): string {
  if (err instanceof Error) {
    const raw = err.message || ''
    const lower = raw.toLowerCase()
    const isLocal = (ctx?.baseUrl || '').includes('127.0.0.1') || (ctx?.baseUrl || '').includes('localhost') || (ctx?.kind === 'image')
    if (lower.includes('abort') || raw.includes('取消') || raw.includes('aborted')) {
      return '请求已取消'
    }
    if (raw.includes('超时') || lower.includes('timeout') || lower.includes('timed out')) {
      return '请求超时，请重试'
    }
    // 针对图片 vision：本地服务未启动的 Failed to fetch 需给出可操作提示
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error') || lower.includes('load failed')) {
      if (isLocal) {
        const u = ctx?.baseUrl || 'http://127.0.0.1:11438/v1'
        return `无法连接本地翻译服务 ${u}，请确认 smodeltrans 已启动且 health 返回 ok（参考 OPENAI_COMPAT_API.md）\\n原始错误: ${raw.slice(0,120)}`
      }
      return '网络错误，请检查网络或接口地址'
    }
    const sanitized = raw.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, '[REDACTED]')
    return sanitized.slice(0, 500) || '翻译失败，请重试'
  }
  return '翻译失败，请重试'
}

function migrateEntry(entry: unknown): StoredSource | null {
  if (!entry || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  const id = typeof obj['id'] === 'string' ? (obj['id'] as string) : `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const name = typeof obj['name'] === 'string' ? (obj['name'] as string) : ''
  const baseUrl = typeof obj['baseUrl'] === 'string' ? (obj['baseUrl'] as string) : ''
  const apiKey = typeof obj['apiKey'] === 'string' ? (obj['apiKey'] as string) : ''
  const createdAt = typeof obj['createdAt'] === 'number' ? (obj['createdAt'] as number) : Date.now()

  if (Array.isArray(obj['models']) && typeof obj['activeModel'] === 'string') {
    const list = (obj['models'] as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    const active = String(obj['activeModel']).trim()
    if (list.length === 0) return null
    return {
      id,
      name,
      baseUrl,
      apiKey,
      models: list,
      activeModel: active && list.includes(active) ? active : list[0]!,
      createdAt,
    }
  }
  if (typeof obj['model'] === 'string') {
    const m = String(obj['model']).trim()
    if (!m) return null
    return {
      id,
      name,
      baseUrl,
      apiKey,
      models: [m],
      activeModel: m,
      createdAt,
    }
  }
  return null
}

async function getActiveSource(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  try {
    const res = await chrome.storage.local.get([MODELS_KEY, ACTIVE_KEY])
    const raw = res[MODELS_KEY] as unknown
    const activeId = res[ACTIVE_KEY] as unknown
    if (!Array.isArray(raw) || raw.length === 0) return null
    const migrated = (raw as unknown[]).map(migrateEntry).filter((v): v is StoredSource => v !== null)
    if (migrated.length === 0) return null
    let picked: StoredSource | undefined
    if (typeof activeId === 'string' && activeId) {
      picked = migrated.find((m) => m.id === activeId)
    }
    if (!picked) picked = migrated[0]
    if (!picked) return null
    const model = (picked.activeModel || '').trim()
    const baseUrl = (picked.baseUrl || '').trim()
    const apiKey = (picked.apiKey || '').trim()
    if (!model || !baseUrl) return null
    return { baseUrl, apiKey, model }
  } catch {
    return null
  }
}

async function resolveTarget(explicit?: string): Promise<string> {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  try {
    const res = await chrome.storage.local.get([TARGET_LANG_KEY, DRAFT_KEY])
    const lang = res[TARGET_LANG_KEY] as unknown
    if (typeof lang === 'string' && lang.trim()) return lang.trim()
    const draft = res[DRAFT_KEY] as unknown
    if (draft && typeof draft === 'object') {
      const t = (draft as DraftStore).target
      if (typeof t === 'string' && t.trim()) return t.trim()
    }
  } catch {
    // ignore storage errors
  }
  return '中文'
}

// ---------- runtime.onMessage: SAI_CLOSE_ALL / SAI_CLOSE_ALL_BG ----------
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: unknown) => void): boolean | void => {
  if (!message || typeof message !== 'object') return
  const m = message as Record<string, unknown>
  const t = m['type'] as string | undefined
  if (t === 'SAI_CLOSE_ALL_BG' && typeof m['tabId'] === 'number') {
    const tabId = m['tabId'] as number
    chrome.tabs.sendMessage(tabId, { type: 'SAI_CLOSE_ALL' }).catch(() => {})
    try { (sendResponse as (r: unknown) => void)({ ok: true }) } catch {}
    return true
  }
  if (t === 'SAI_CLOSE_ALL' && typeof m['tabId'] === 'number') {
    const tabId = m['tabId'] as number
    chrome.tabs.sendMessage(tabId, { type: 'SAI_CLOSE_ALL' }).catch(() => {})
    try { (sendResponse as (r: unknown) => void)({ ok: true }) } catch {}
    return true
  }
  if (t === 'SAI_CLOSE_ALL') {
    // 广播到所有标签页（用于弹窗一键关闭所有）
    try {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'SAI_CLOSE_ALL' }).catch(() => {})
      })
    } catch {
      // fallback: 仅当前活动页
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0]
        if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'SAI_CLOSE_ALL' }).catch(() => {})
      })
    }
    try { (sendResponse as (r: unknown) => void)({ ok: true }) } catch {}
    return true
  }
})

// ---------- runtime.onMessage: SAI_FETCH_IMAGE / SAI_CAPTURE ----------
// content 内存位图（canvas）失败后的兜底：优先命中缓存、零图片宿主请求。
// - SAI_FETCH_IMAGE：SW 以扩展源重取，cache:'force-cache' 优先读已加载的内存/磁盘缓存，
//   credentials:include + referrer 透传降热链 403；15s 超时、10MiB 与 image/* 守卫。
// - SAI_CAPTURE：截可见区整帧透传，裁剪在 content 做（SW 无 DOM），零图片宿主请求，无 CORS/403。
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean | void => {
    if (!message || typeof message !== 'object') return
    const m = message as Record<string, unknown>
    const t = m['type']
    if (t !== 'SAI_FETCH_IMAGE' && t !== 'SAI_CAPTURE') return
    void (async () => {
      if (t === 'SAI_CAPTURE') {
        try {
          const winId = sender.tab?.windowId
          const dataUrl = winId != null
            ? await chrome.tabs.captureVisibleTab(winId, { format: 'jpeg', quality: 90 })
            : await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 90 })
          if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
            sendResponse({ ok: true, dataUrl })
          } else {
            sendResponse({ ok: false, error: 'capture empty' })
          }
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'capture failed' })
        }
        return
      }
      // SAI_FETCH_IMAGE
      try {
        const url = typeof m['url'] === 'string' ? (m['url'] as string).trim() : ''
        if (!/^https?:\/\//i.test(url)) {
          sendResponse({ ok: false, error: 'bad url' })
          return
        }
        const referrer = typeof m['referrer'] === 'string' && /^https?:\/\//i.test((m['referrer'] as string))
          ? ((m['referrer'] as string))
          : (sender.tab?.url && /^https?:\/\//i.test(sender.tab.url) ? sender.tab.url : undefined)
        const ctl = new AbortController()
        const timer = setTimeout(() => { try { ctl.abort() } catch {} }, 15_000)
        try {
          const res = await fetch(url, {
            signal: ctl.signal,
            cache: 'force-cache',
            credentials: 'include',
            referrer,
            referrerPolicy: 'no-referrer-when-downgrade',
            headers: { Accept: 'image/*' },
          })
          if (!res.ok) {
            sendResponse({ ok: false, error: `HTTP ${res.status}` })
            return
          }
          const ct = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
          if (ct && !ct.startsWith('image/')) {
            sendResponse({ ok: false, error: `bad content-type ${ct.slice(0, 60)}` })
            return
          }
          const buf = await res.arrayBuffer()
          if (!buf || buf.byteLength <= 0 || buf.byteLength > 10 * 1024 * 1024) {
            sendResponse({ ok: false, error: 'too large' })
            return
          }
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          }
          const mime = ct && ct.startsWith('image/') ? ct : 'image/jpeg'
          sendResponse({ ok: true, dataUrl: `data:${mime};base64,${btoa(binary)}` })
        } finally {
          clearTimeout(timer)
        }
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'fetch failed' })
      }
    })()
    return true
  },
)

// ---------- runtime.onMessage: SAI_TRANSLATE ----------
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateRes) => void,
  ): boolean | void => {
    if (!message || typeof message !== 'object') return
    const m = message as Record<string, unknown>
    if (m['type'] !== 'SAI_TRANSLATE') return
    const req = message as TranslateReq
    const requestId =
      typeof req.requestId === 'string' && req.requestId ? req.requestId : `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const rawText = typeof req.text === 'string' ? req.text : String(req.text ?? '')

    // Use typed access for optional vision fields (avoids inline cast) — hybrid: data:* or http(s) URL
    let rawImageDataUrl = ''
    if ('imageDataUrl' in req && typeof req.imageDataUrl === 'string') {
      rawImageDataUrl = req.imageDataUrl.trim()
    }
    let rawImageUrl = ''
    if ('imageUrl' in req && typeof req.imageUrl === 'string') {
      rawImageUrl = req.imageUrl.trim()
    }
    let kindRaw = ''
    if ('kind' in req && typeof req.kind === 'string') {
      kindRaw = req.kind.trim().toLowerCase()
    }

    const prev = pending.get(requestId)
    if (prev) {
      try {
        prev.abort()
      } catch {
        // ignore
      }
      pending.delete(requestId)
    }

    void (async () => {
      // Determine image vs text before creating timeout — hybrid: data: or http(s) far-end
      const trimmedTextForCheck = rawText.trim()
      const textIsDataUrlCheck = trimmedTextForCheck.toLowerCase().startsWith('data:image/')
      const textIsHttpCheck = /^https?:\/\/\S+/i.test(trimmedTextForCheck)
      let isImage: boolean
      if (kindRaw === 'image') isImage = true
      else if (kindRaw === 'text') isImage = false
      else {
        isImage = !!rawImageUrl || !!rawImageDataUrl || textIsDataUrlCheck || textIsHttpCheck
      }
      const imageUrlForVision = rawImageUrl || rawImageDataUrl || (textIsDataUrlCheck || textIsHttpCheck ? trimmedTextForCheck : '')
      const timeoutMs = isImage ? TIMEOUT_IMAGE : TIMEOUT_TEXT

      const controller = new AbortController()
      pending.set(requestId, controller)

      let timeoutId: number | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          try {
            controller.abort()
          } catch {
            // ignore
          }
          reject(new Error('请求超时，请重试'))
        }, timeoutMs) as unknown as number

        controller.signal.addEventListener(
          'abort',
          () => {
            reject(new Error('请求已取消'))
          },
          { once: true },
        )
      })

      // 用于错误提示的上下文
      let capturedBaseUrl = ''
      let capturedKind: 'image' | 'text' = isImage ? 'image' : 'text'

      try {
        if (isImage) {
          // Vision branch - hybrid validation: data:* 或 http(s) 远端（OPENAI_COMPAT_API.md §3.1）
          const imageUrl = imageUrlForVision
          const isData = /^data:image\/[^;]+(?:;charset=[^;]+)?;base64,/i.test(imageUrl.trim())
          const isHttp = /^https?:\/\//i.test(imageUrl.trim())
          if (!imageUrl || (!isData && !isHttp)) {
            throw new Error('无效的图片数据，需为 data:image/*;base64 或 http(s) URL 格式')
          }
          if (isHttp) {
            try {
              const u = new URL(imageUrl.trim())
              if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
            } catch {
              throw new Error('无效的图片 URL')
            }
          }

          const target = await resolveTarget(req.target)
          const source = await getActiveSource()
          if (!source) {
            throw new Error('未配置模型，请先在弹窗中添加模型')
          }
          capturedBaseUrl = source.baseUrl

          // Vision fetch with 40s timeout and pending map; live check handled via getActiveSource + callVisionLLM error mapping
          const result = await Promise.race([
            callVisionLLM(source.baseUrl, source.apiKey, source.model, target, imageUrl, controller.signal),
            timeoutPromise,
          ])

          clearTimeout(timeoutId as unknown as number)

          const okRes: TranslateRes = {
            type: 'SAI_TRANSLATE_RESULT',
            requestId,
            ok: true,
            translated: result.text,
            model: source.model,
            annotatedDataUrl: result.annotatedDataUrl,
          }

          try {
            sendResponse(okRes)
          } catch {
            // sendResponse may fail if channel closed
          }
          if (sender.tab?.id != null) {
            chrome.tabs.sendMessage(sender.tab.id, okRes).catch(() => {})
          }
        } else {
          // Text branch
          const text = rawText.slice(0, TEXT_LIMIT).trim()
          if (!text) {
            throw new Error('未选中有效文本')
          }

          const target = await resolveTarget(req.target)
          const source = await getActiveSource()
          if (!source) {
            throw new Error('未配置模型，请先在弹窗中添加模型')
          }
          capturedBaseUrl = source.baseUrl

          const preserveMarkup = (req as { html?: unknown }).html === true
          const translated = await Promise.race([
            callLLM(source.baseUrl, source.apiKey, source.model, target, text, controller.signal, preserveMarkup ? { preserveMarkup: true } : undefined),
            timeoutPromise,
          ])

          clearTimeout(timeoutId as unknown as number)

          const okRes: TranslateRes = {
            type: 'SAI_TRANSLATE_RESULT',
            requestId,
            ok: true,
            translated,
            model: source.model,
          }

          try {
            sendResponse(okRes)
          } catch {
            // sendResponse may fail if channel closed
          }
          if (sender.tab?.id != null) {
            chrome.tabs.sendMessage(sender.tab.id, okRes).catch(() => {})
          }
        }
      } catch (e) {
        clearTimeout(timeoutId as unknown as number)
        try {
          // Ensure no apiKey leak - demonstrate sanitizeHeaders usage and only log preview/length
          void sanitizeHeaders({ Authorization: 'Bearer dummy' })
          const baseDetails: Record<string, unknown> = {
            requestId,
            senderTabId: sender.tab?.id,
            senderUrl: sender.tab?.url,
            timeoutMs,
            kind: capturedKind,
            baseUrl: capturedBaseUrl,
          }
          if (isImage) {
            const preview = imageUrlForVision.slice(0, 80)
            const isHttpPreview = /^https?:\/\//i.test(imageUrlForVision)
            logFetchFailed('background:SAI_TRANSLATE', e, {
              ...baseDetails,
              imageUrlLength: imageUrlForVision.length,
              imageUrlPreview: preview,
              imageUrlIsHttp: isHttpPreview,
            })
          } else {
            logFetchFailed('background:SAI_TRANSLATE', e, {
              ...baseDetails,
              rawTextLength: rawText.length,
              rawTextPreview: rawText.slice(0, 80),
            })
          }
        } catch {}
        const error = mapError(e, { kind: capturedKind, baseUrl: capturedBaseUrl })
        const errRes: TranslateRes = {
          type: 'SAI_TRANSLATE_RESULT',
          requestId,
          ok: false,
          error,
        }
        try {
          sendResponse(errRes)
        } catch {
          // ignore
        }
        if (sender.tab?.id != null) {
          chrome.tabs.sendMessage(sender.tab.id, errRes).catch(() => {})
        }
      } finally {
        pending.delete(requestId)
        clearTimeout(timeoutId as unknown as number)
      }
    })()

    return true
  },
)

// ---------- commands ----------
chrome.commands.onCommand.addListener(async (command: string) => {
  try {
    if (command === 'translate-selection') {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tab = tabs[0]
      if (!tab?.id) return
      await chrome.tabs.sendMessage(tab.id, { type: 'SAI_TRIGGER_TRANSLATE' }).catch(() => {})
    } else if (command === 'toggle_inline' || command === 'toggle-inline') {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tab = tabs[0]
      if (!tab?.id) return
      await chrome.tabs.sendMessage(tab.id, { type: 'SAI_TOGGLE_INLINE' }).catch(() => {})
    }
  } catch {
    // Swallow command handling errors to keep SW alive
  }
})

export {}
