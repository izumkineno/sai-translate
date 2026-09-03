// Shared translate helpers — used by popup ModelTranslate and background SW
// OpenAI SDK (browser) + hy-mt2 hand-written fallback
import OpenAI from 'openai'
export function extractContent(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const obj = json as Record<string, unknown>
  const choices = obj['choices']
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const c0 = choices[0] as Record<string, unknown>
    const msg = c0['message'] as Record<string, unknown> | undefined
    if (msg && typeof msg['content'] === 'string') return (msg['content'] as string).trim()
    if (typeof c0['text'] === 'string') return (c0['text'] as string).trim()
  }
  if (typeof obj['content'] === 'string') return (obj['content'] as string).trim()
  if (typeof obj['text'] === 'string') return (obj['text'] as string).trim()
  return ''
}

export function isHyModel(modelName: string): boolean {
 const lower = modelName.toLowerCase()
 return lower.startsWith('hy') || lower.startsWith('hunyuan') || lower.includes('hy-mt') || lower.includes('hy_mt')
}

export function toHyTarget(target: string, srcText: string): string {
  if (target === '中文') return 'Chinese'
  if (target === 'English') return 'English'
  if (target === '日本語') return 'Japanese'
  if (target === '한국어') return 'Korean'
  if (target === 'Français') return 'French'
  if (target === 'Deutsch') return 'German'
  if (target === 'Auto') return /[\u4e00-\u9fff]/.test(srcText) ? 'English' : 'Chinese'
  return target
}

export type ChatBody = {
  body: Record<string, unknown>
  hyTarget: string
  modelForRequest: string
  sys: string
}

export function buildChatBody(model: string, target: string, text: string): ChatBody {
  const isHy = isHyModel(model)
  const hyTarget = isHy ? toHyTarget(target, text) : ''
  const modelForRequest = isHy && hyTarget && !model.includes(':') ? `${model}:${hyTarget}` : model
  const sys = isHy
    ? 'You are a professional translator. Only output the translation, no explanation.'
    : target === 'Auto'
      ? 'You are a professional translator. Detect the source language and translate to the other language: if the text is Chinese, translate to English; otherwise translate to Chinese. Only output the translation, no explanation.'
      : `You are a professional translator. Translate the following text to ${target}. Only output the translation, no explanation.`

  const body: Record<string, unknown> = {
    model: modelForRequest,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
    stream: false,
  }
  if (isHy && hyTarget) {
    body['target_language'] = hyTarget
    body['language'] = hyTarget
    body['target_lang'] = hyTarget
  }
  return { body, hyTarget, modelForRequest, sys }
}

export function buildVisionBody(model: string, target: string, imageUrl: string): ChatBody {
  const isHy = isHyModel(model)
  const hyTarget = isHy ? toHyTarget(target, '') : ''
  const modelForRequest = isHy && hyTarget && !model.includes(':') ? `${model}:${hyTarget}` : model
  const sys = isHy
    ? 'You are a professional translator. Only output the translation, no explanation.'
    : target === 'Auto'
      ? 'You are a professional translator. Detect the source language and translate to the other language: if the text is Chinese, translate to English; otherwise translate to Chinese. Only output the translation, no explanation.'
      : `You are a professional translator. Translate the following text to ${target}. Only output the translation, no explanation.`

  const body: Record<string, unknown> = {
    model: modelForRequest,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'text', text: `Translate to ${hyTarget || target}` },
        { type: 'image_url', image_url: { url: imageUrl } },
      ] },
    ],
    temperature: 0.3,
    stream: false,
  }
  if (isHy && hyTarget) {
    body['target_language'] = hyTarget
    body['language'] = hyTarget
    body['target_lang'] = hyTarget
  }
  return { body, hyTarget, modelForRequest, sys }
}

export type TranslateReq = {
  type: 'SAI_TRANSLATE'
  text: string
  target?: string
  requestId: string
  kind?: 'text' | 'image'
  imageDataUrl?: string
  imageUrl?: string
}


export type TranslateRes =
  | { type: 'SAI_TRANSLATE_RESULT'; requestId: string; ok: true; translated: string; model: string; annotatedDataUrl?: string }
  | { type: 'SAI_TRANSLATE_RESULT'; requestId: string; ok: false; error: string }

export function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...h }
  if (out['Authorization']) out['Authorization'] = 'Bearer [REDACTED]'
  return out
}

// 规范化 OpenAI 兼容 baseUrl，使扩展侧与 test_vision_api.py 的 base+"/v1" 形态一致
// 参考 docs/OPENAI_COMPAT_API.md §1：默认 127.0.0.1:11438，路由均为 /v1/...
export function normalizeBaseUrl(baseUrl: string): string {
  const b = (baseUrl || '').trim().replace(/\/$/, '')
  if (!b) return b
  if (/\/v1\/?$/.test(b)) return b.replace(/\/$/, '')
  if (b.endsWith('/chat/completions') || b.endsWith('/v1/chat/completions')) return b
  return `${b}/v1`
}
export function chatCompletionsUrl(baseUrl: string): string {
  const nb = normalizeBaseUrl(baseUrl)
  if (nb.endsWith('/chat/completions') || nb.endsWith('/v1/chat/completions')) return nb
  return `${nb}/chat/completions`
}
export function modelsUrl(baseUrl: string): string {
  const nb = normalizeBaseUrl(baseUrl)
  if (nb.endsWith('/models')) return nb
  return `${nb}/models`
}

export function logFetchFailed(context: string, err: unknown, details: Record<string, unknown>) {
  const e = err instanceof Error ? err : new Error(String(err))
  const msg = e.message || ''
  const isFailed = msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('load failed')
  if (!isFailed && !msg.toLowerCase().includes('fetch')) return
  try {
    // eslint-disable-next-line no-console
    console.error(`[sai-translate] ${context} — Failed to fetch (detailed)`, {
      time: new Date().toISOString(),
      errorName: e.name,
      errorMessage: msg,
      errorStack: e.stack?.slice(0, 2000),
      online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      location: typeof location !== 'undefined' ? location.href : undefined,
      ...details,
    })
  } catch {}
}

export function extractVisionResult(json: unknown): { text: string; annotatedDataUrl: string } {
  if (!json || typeof json !== 'object') return { text: '', annotatedDataUrl: '' }
  const obj = json as Record<string, unknown>
  const choices = obj['choices']
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const c0 = choices[0] as Record<string, unknown>
    const msg = c0['message'] as Record<string, unknown> | undefined
    if (msg) {
      const content = msg['content']
      if (typeof content === 'string') {
        return { text: (content as string).trim(), annotatedDataUrl: '' }
      }
      if (Array.isArray(content)) {
        let text = ''
        let annotatedDataUrl = ''
        for (const part of content) {
          if (!part || typeof part !== 'object') continue
          const p = part as Record<string, unknown>
          if (!text && p['type'] === 'text' && typeof p['text'] === 'string') {
            text = (p['text'] as string).trim()
          }
          if (!annotatedDataUrl && p['type'] === 'image_url') {
            const imageUrl = p['image_url'] as Record<string, unknown> | undefined
            if (imageUrl && typeof imageUrl['url'] === 'string') {
              annotatedDataUrl = (imageUrl['url'] as string).trim()
            } else if (typeof p['url'] === 'string') {
              annotatedDataUrl = (p['url'] as string).trim()
            }
          }
        }
        return { text, annotatedDataUrl }
      }
    }
  }
  return { text: '', annotatedDataUrl: '' }
}

function getOpenAIClient(baseUrl: string, apiKey: string) {
  const base = normalizeBaseUrl(baseUrl)
  return new OpenAI({
    baseURL: base,
    apiKey: apiKey.trim() || 'sk-not-needed',
    dangerouslyAllowBrowser: true,
    // 显式使用原生 fetch，确保 service worker / popup 均可用
    fetch: globalThis.fetch.bind(globalThis) as unknown as typeof fetch,
  })
}

// helper to call LLM directly (for background, reuses same body building)
// hy-mt2 保持手写 fetch 以保留 target_language/language/target_lang 字段；非 hy 走 OpenAI SDK
export async function callLLM(baseUrl: string, apiKey: string, model: string, target: string, text: string, signal?: AbortSignal): Promise<string> {
  const isHy = isHyModel(model)
  const { body, hyTarget, modelForRequest } = buildChatBody(model, target, text)
  if (isHy) {
    const base = normalizeBaseUrl(baseUrl)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`
    const url = chatCompletionsUrl(base)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      logFetchFailed('callLLM:hy', err, {
        url,
        method: 'POST',
        baseUrl: base,
        model,
        target,
        hyTarget,
        textLength: text.length,
        textPreview: text.slice(0, 80),
        headers: sanitizeHeaders(headers),
        bodyPreview: JSON.stringify(body).slice(0, 500),
      })
      throw err
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      let msg = t
      try {
        const j = JSON.parse(t) as Record<string, unknown>
        const err = j['error'] as Record<string, unknown> | undefined
        if (err && typeof err['message'] === 'string') msg = err['message'] as string
      } catch {}
      throw new Error(msg ? `${msg}（HTTP ${res.status} · ${url}）` : `请求失败 HTTP ${res.status} · ${url}`)
    }
    const json = (await res.json()) as unknown
    const content = extractContent(json)
    if (!content) throw new Error('未获取到翻译结果')
    return content
  }
  // 非 hy 走 OpenAI SDK
  const client = getOpenAIClient(baseUrl, apiKey)
  try {
    const completion = await client.chat.completions.create(
      {
        model: modelForRequest,
        messages: body.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        temperature: body.temperature as number,
        stream: false,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { signal },
    )
    const content = (completion.choices?.[0]?.message?.content ?? '').trim() || extractContent(completion as unknown)
    if (!content) throw new Error('未获取到翻译结果')
    return content
  } catch (err) {
    logFetchFailed('callLLM:openai', err, {
      baseUrl: normalizeBaseUrl(baseUrl),
      model,
      target,
      modelForRequest,
      textLength: text.length,
      textPreview: text.slice(0, 80),
    })
    // 透传 OpenAI 的错误信息
    if (err instanceof Error) {
      const anyErr = err as unknown as { status?: number; error?: { message?: string }; message?: string }
      const msg = (anyErr.error as { message?: string } | undefined)?.message || anyErr.message || err.message
      throw new Error(msg || '请求失败')
    }
    throw err
  }
}

export async function callVisionLLM(baseUrl: string, apiKey: string, model: string, target: string, imageUrl: string, signal?: AbortSignal): Promise<{ text: string; annotatedDataUrl: string }> {
  const isHy = isHyModel(model)
  const { body, hyTarget, modelForRequest } = buildVisionBody(model, target, imageUrl)
  if (isHy) {
    const base = normalizeBaseUrl(baseUrl)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`
    const url = chatCompletionsUrl(base)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      logFetchFailed('callVisionLLM:hy', err, {
        url,
        method: 'POST',
        baseUrl: base,
        model,
        target,
        hyTarget,
        imageUrlLength: imageUrl.length,
        imageUrlPreview: imageUrl.slice(0, 80),
        imageUrlIsHttp: /^https?:\/\//i.test(imageUrl),
        headers: sanitizeHeaders(headers),
        bodyPreview: JSON.stringify(body).slice(0, 500),
      })
      throw err
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      let msg = t
      try {
        const j = JSON.parse(t) as Record<string, unknown>
        const err = j['error'] as Record<string, unknown> | undefined
        if (err && typeof err['message'] === 'string') msg = err['message'] as string
        else if (typeof j['message'] === 'string') msg = j['message'] as string
      } catch {}
      throw new Error(msg ? `${msg}（HTTP ${res.status} · ${url}）` : `请求失败 HTTP ${res.status} · ${url}`)
    }
    const json = (await res.json()) as unknown
    const result = extractVisionResult(json)
    if (!result.text && !result.annotatedDataUrl) throw new Error('未获取到翻译结果')
    return result
  }
  // 非 hy 走 OpenAI SDK
  const client = getOpenAIClient(baseUrl, apiKey)
  try {
    const completion = await client.chat.completions.create(
      {
        model: modelForRequest,
        messages: body.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        temperature: body.temperature as number,
        stream: false,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { signal },
    )
    const result = extractVisionResult(completion as unknown)
    if (result.text || result.annotatedDataUrl) return result
    // fallback: SDK returned plain string content
    const direct = (completion.choices?.[0]?.message?.content ?? '') as unknown
    if (typeof direct === 'string' && direct.trim()) {
      return { text: direct.trim(), annotatedDataUrl: '' }
    }
    throw new Error('未获取到翻译结果')
  } catch (err) {
    logFetchFailed('callVisionLLM:openai', err, {
      baseUrl: normalizeBaseUrl(baseUrl),
      model,
      target,
      modelForRequest,
      imageUrlLength: imageUrl.length,
      imageUrlPreview: imageUrl.slice(0, 80),
      imageUrlIsHttp: /^https?:\/\//i.test(imageUrl),
    })
    if (err instanceof Error) {
      const anyErr = err as unknown as { status?: number; error?: { message?: string }; message?: string }
      const msg = (anyErr.error as { message?: string } | undefined)?.message || anyErr.message || err.message
      throw new Error(msg || '请求失败')
    }
    throw err
  }
}

// 通过 OpenAI SDK 拉取模型列表，失败回退 fetch
export async function listModelsViaSDK(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const client = getOpenAIClient(baseUrl, apiKey)
  try {
    const res = await client.models.list({ signal } as unknown as Record<string, unknown>)
    const ids = (res.data ?? []).map((m) => (m.id ?? '').trim()).filter(Boolean)
    if (ids.length) return ids.slice(0, 50)
    throw new Error('未获取到模型列表')
  } catch (err) {
    logFetchFailed('listModelsViaSDK:openai', err, {
      baseUrl: normalizeBaseUrl(baseUrl),
      method: 'GET',
      url: modelsUrl(baseUrl),
    })
    // 回退手写 fetch
    const base = normalizeBaseUrl(baseUrl)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`
    const url = modelsUrl(base)
    let res: Response
    try {
      res = await fetch(url, { method: 'GET', headers, signal })
    } catch (e) {
      logFetchFailed('listModelsViaSDK:fetch', e, {
        url,
        method: 'GET',
        baseUrl: base,
        headers: sanitizeHeaders(headers),
      })
      throw e
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `请求失败 ${res.status}`)
    }
    const json = (await res.json().catch(() => null)) as unknown
    const list = extractModelIds(json)
    if (list.length === 0) throw new Error('未获取到模型列表')
    return list
  }
}

// 兼容旧调用：从任意 JSON 抽模型 id 列表（供 fetch 回退用）
function extractModelIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const obj = json as Record<string, unknown>
  const candidates: unknown[] = []
  if (Array.isArray(obj['data'])) candidates.push(...(obj['data'] as unknown[]))
  if (Array.isArray(obj['models'])) candidates.push(...(obj['models'] as unknown[]))
  if (Array.isArray(obj['list'])) candidates.push(...(obj['list'] as unknown[]))
  if (Array.isArray(json)) candidates.push(...(json as unknown[]))
  const ids: string[] = []
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) ids.push(item.trim())
    else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      const v = rec['id'] ?? rec['name'] ?? rec['model']
      if (typeof v === 'string' && v.trim()) ids.push(v.trim())
    }
  }
  const seen: Record<string, true> = {}
  const deduped: string[] = []
  for (const id of ids) {
    if (!seen[id]) {
      seen[id] = true
      deduped.push(id)
    }
  }
  return deduped.slice(0, 50)
}
