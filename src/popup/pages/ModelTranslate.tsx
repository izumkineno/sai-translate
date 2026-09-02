import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { activeModelId, models, setActiveModel, setActiveModelForSource } from '../store/models'
import { loadDraft, saveDraft } from '../store/draft'

export default function ModelTranslate() {
  const [input, setInput] = createSignal('')
  const [output, setOutput] = createSignal('')
  const [target, setTarget] = createSignal('中文')
  const [translating, setTranslating] = createSignal(false)
  const [terr, setTerr] = createSignal('')
  let draftLoaded = false
  let saveTimer: number | undefined = undefined

  onMount(async () => {
    try {
      const d = await loadDraft()
      if (d) {
        if (typeof d.input === 'string') setInput(d.input)
        if (typeof d.output === 'string') setOutput(d.output)
        if (typeof d.target === 'string' && d.target) setTarget(d.target)
      }
    } catch {}
    draftLoaded = true
  })

  const scheduleSave = () => {
    if (!draftLoaded) return
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveDraft({ input: input(), output: output(), target: target() })
    }, 120)
  }

  createEffect(() => {
    input()
    scheduleSave()
  })
  createEffect(() => {
    output()
    scheduleSave()
  })
  createEffect(() => {
    target()
    scheduleSave()
  })
  onCleanup(() => {
    clearTimeout(saveTimer)
    void saveDraft({ input: input(), output: output(), target: target() })
  })

  const selectedSource = () => models().find((m) => m.id === activeModelId()) ?? models()[0] ?? null

 const onTranslate = async () => {
 const text = input().trim()
 if (!text) {
 setTerr('请输入待翻译内容')
 return
 }
 const m = selectedSource()
 if (!m) {
 setTerr('请先在模型配置页添加模型')
 return
 }
 if (!m.activeModel) {
 setTerr('该源暂无可用模型，请在模型配置页选择模型')
 return
 }
 setTranslating(true)
 setTerr('')
 setOutput('')
 try {
 const base = m.baseUrl.replace(/\/$/, '')
 const headers: Record<string, string> = { 'Content-Type': 'application/json' }
 if (m.apiKey.trim()) headers['Authorization'] = `Bearer ${m.apiKey.trim()}`
 // hy-mt2 专用：显式附加 target 语言，避免仅靠 system 指令被 Hy 忽略
 const isHy = /hy/i.test(m.activeModel)
 const toHyTarget = (t: string, src: string): string => {
 if (t === '中文') return 'Chinese'
 if (t === 'English') return 'English'
 if (t === '日本語') return 'Japanese'
 if (t === '한국어') return 'Korean'
 if (t === 'Français') return 'French'
 if (t === 'Deutsch') return 'German'
 if (t === 'Auto') return /[\u4e00-\u9fff]/.test(src) ? 'English' : 'Chinese'
 return t
 }
 const hyTarget = isHy ? toHyTarget(target(), text) : ''
 const modelForRequest = isHy && hyTarget && !m.activeModel.includes(':') ? `${m.activeModel}:${hyTarget}` : m.activeModel
 // 非 hy：system 携带目标语；hy：system 仅作风格约束，目标语由 body 显式字段与 model 后缀承载
 const sys = isHy
 ? 'You are a professional translator. Only output the translation, no explanation.'
 : target() === 'Auto'
 ? 'You are a professional translator. Detect the source language and translate to the other language: if the text is Chinese, translate to English; otherwise translate to Chinese. Only output the translation, no explanation.'
 : `You are a professional translator. Translate the following text to ${target()}. Only output the translation, no explanation.`
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
 // Hy 侧优先读取 body.target_language / body.language，其次 model:后缀；system 不再解析
 body['target_language'] = hyTarget
 body['language'] = hyTarget
 body['target_lang'] = hyTarget
 }
 const res = await fetch(`${base}/chat/completions`, {
 method: 'POST',
 headers,
 body: JSON.stringify(body),
 })
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
 setOutput(content)
 } catch (e) {
 const msg = e instanceof Error ? e.message : '翻译失败'
 setTerr(msg.length > 200 ? `${msg.slice(0, 200)}...` : msg)
 } finally {
 setTranslating(false)
 }
 }

  const onCopy = async () => {
    const t = output()
    if (!t) return
    try {
      await navigator.clipboard.writeText(t)
    } catch {
      const el = document.createElement('textarea')
      el.value = t
      document.body.appendChild(el)
      el.select()
      const doc = document as unknown as { execCommand(cmd: string): boolean }
      doc.execCommand('copy')
      el.remove()
    }
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
      <div class="n-layout-content__header">
        <div class="n-layout-content__title">翻译</div>
        <Show when={models().length > 0}>
          <span style={{ 'font-size': '12px', color: 'var(--n-text-3)' }}>{models().length} 个源</span>
        </Show>
      </div>

      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">翻译</span>
          <span class="n-card-header__extra">直调 {selectedSource()?.activeModel ?? '—'}</span>
        </div>
 <div class="n-card__content" style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
 <Show
 when={models().length > 0}
 fallback={<div class="n-alert n-alert--error">暂无可用模型，请先在模型配置页添加 OpenAI 兼容模型</div>}
 >
 <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
 <div style={{ flex: '1 1 132px', display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
 <span style={{ 'font-size': '10px', color: 'var(--n-text-3)', 'letter-spacing': '0.4px' }}>提供商</span>
 <select
 class="n-select"
 value={activeModelId() ?? ''}
 onChange={(e) => setActiveModel(e.currentTarget.value)}
 >
 <For each={models()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
 </select>
 </div>
 <Show when={selectedSource()}>
 <div style={{ flex: '1 1 132px', display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
 <span style={{ 'font-size': '10px', color: 'var(--n-text-3)', 'letter-spacing': '0.4px' }}>模型 · {selectedSource()!.models.length}</span>
 <select
 class="n-select"
 value={selectedSource()!.activeModel}
 onChange={(e) => {
 const src = selectedSource()
 if (src) void setActiveModelForSource(src.id, e.currentTarget.value)
 }}
 >
 <For each={selectedSource()!.models}>{(m) => <option value={m}>{m}</option>}</For>
 </select>
 </div>
 </Show>
 <div style={{ flex: '0 0 110px', display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
 <span style={{ 'font-size': '10px', color: 'var(--n-text-3)', 'letter-spacing': '0.4px' }}>目标语</span>
 <select class="n-select" value={target()} onChange={(e) => setTarget(e.currentTarget.value)}>
 <option value="中文">→ 中文</option>
 <option value="English">→ English</option>
 <option value="日本語">→ 日本語</option>
 <option value="한국어">→ 한국어</option>
 <option value="Français">→ Français</option>
 <option value="Deutsch">→ Deutsch</option>
 <option value="Auto">→ Auto</option>
 </select>
 </div>
 <div style={{ display: 'flex', 'align-items': 'flex-end' }}>
 <button class="n-button n-button--primary" type="button" onClick={onTranslate} disabled={translating()} style={{ height: '32px', 'white-space': 'nowrap' }}>
 {translating() ? '翻译中...' : '翻译'}
 </button>
 </div>
 </div>

            <textarea
              class="n-textarea"
              placeholder="输入待翻译文本..."
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              rows={3}
            />

            <Show when={terr()}>
              <div class="n-alert n-alert--error">{terr()}</div>
            </Show>

            <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
              <span style={{ 'font-size': '12px', color: 'var(--n-text-3)' }}>译文</span>
              <Show when={output()}>
                <button class="n-icon-btn" type="button" onClick={onCopy} title="复制">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3" />
                  </svg>
                </button>
              </Show>
            </div>
            <div class={`n-translate-output ${!output() && !terr() ? 'n-translate-output--placeholder' : ''} ${terr() ? 'n-translate-output--error' : ''}`}>
              {output() || (terr() ? terr() : '翻译结果将显示在此')}
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

function extractContent(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const obj = json as Record<string, unknown>
  const choices = obj['choices']
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const first = choices[0] as Record<string, unknown>
    const msg = first['message'] as Record<string, unknown> | undefined
    if (msg && typeof msg['content'] === 'string') return msg['content'].trim()
    if (typeof first['text'] === 'string') return (first['text'] as string).trim()
    if (typeof first['content'] === 'string') return (first['content'] as string).trim()
  }
  if (typeof obj['content'] === 'string') return (obj['content'] as string).trim()
  if (typeof obj['text'] === 'string') return (obj['text'] as string).trim()
  return ''
}
