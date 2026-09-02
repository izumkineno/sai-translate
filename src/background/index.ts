// MV3 service worker — handles commands + SAI_TRANSLATE
// No DOM access; only chrome.* + shared/translate

import { callLLM, logFetchFailed, type TranslateReq, type TranslateRes } from '../shared/translate'
const MODELS_KEY = 'sai_translate_models'
const ACTIVE_KEY = 'sai_translate_active_model'
const TARGET_LANG_KEY = 'sai_translate_target_lang'
const DRAFT_KEY = 'sai_translate_draft'

const TEXT_LIMIT = 4000
const TIMEOUT_MS = 20_000

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

function mapError(err: unknown): string {
  if (err instanceof Error) {
    const raw = err.message || ''
    const lower = raw.toLowerCase()
    if (lower.includes('abort') || raw.includes('取消') || raw.includes('aborted')) {
      return '请求已取消'
    }
    if (raw.includes('超时') || lower.includes('timeout') || lower.includes('timed out')) {
      return '请求超时，请重试'
    }
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error') || lower.includes('load failed')) {
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
        }, TIMEOUT_MS) as unknown as number

        controller.signal.addEventListener(
          'abort',
          () => {
            reject(new Error('请求已取消'))
          },
          { once: true },
        )
      })

      try {
        const text = rawText.slice(0, TEXT_LIMIT).trim()
        if (!text) {
          throw new Error('未选中有效文本')
        }

        const target = await resolveTarget(req.target)
        const source = await getActiveSource()
        if (!source) {
          throw new Error('未配置模型，请先在弹窗中添加模型')
        }

 const translated = await Promise.race([callLLM(source.baseUrl, source.apiKey, source.model, target, text, controller.signal), timeoutPromise])

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
      } catch (e) {
        clearTimeout(timeoutId as unknown as number)
        try {
          logFetchFailed('background:SAI_TRANSLATE', e, {
            requestId,
            senderTabId: sender.tab?.id,
            senderUrl: (sender.tab as unknown as { url?: string })?.url ?? (sender as unknown as { url?: string }).url,
            rawTextLength: rawText.length,
            rawTextPreview: rawText.slice(0, 80),
            timeoutMs: TIMEOUT_MS,
          })
        } catch {}
        const error = mapError(e)
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
