// Shared translate helpers — used by popup ModelTranslate and background SW
// Extracted from ModelTranslate.tsx to keep hy2-mt logic single-source

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

export type TranslateReq = {
  type: 'SAI_TRANSLATE'
  text: string
  target?: string
  requestId: string
}

export type TranslateRes =
  | { type: 'SAI_TRANSLATE_RESULT'; requestId: string; ok: true; translated: string; model: string }
  | { type: 'SAI_TRANSLATE_RESULT'; requestId: string; ok: false; error: string }

export function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...h }
  if (out['Authorization']) out['Authorization'] = 'Bearer [REDACTED]'
  return out
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

// helper to call LLM directly (for background, reuses same body building)
export async function callLLM(baseUrl: string, apiKey: string, model: string, target: string, text: string, signal?: AbortSignal): Promise<string> {
  const base = baseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`
  const { body } = buildChatBody(model, target, text)
  const url = `${base}/chat/completions`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    logFetchFailed('callLLM', err, {
      url,
      method: 'POST',
      baseUrl: base,
      model,
      target,
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
    throw new Error(msg || `请求失败 ${res.status}`)
  }
  const json = (await res.json()) as unknown
  const content = extractContent(json)
  if (!content) throw new Error('未获取到翻译结果')
  return content
}
