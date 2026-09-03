import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { loadSettingsDraft, saveSettingsDraft } from '../store/settingsDraft'
import { listModelsViaSDK } from '@/shared/translate'
import {
  activeModelId,
  addSource,
  models,
  removeSource,
  setActiveModel,
  setActiveModelForSource,
  updateSource,
} from '../store/models'
function maskKey(k: string) {
  if (k.length <= 8) return '••••••••'
  return `${k.slice(0, 3)}••••${k.slice(-4)}`
}

export default function Settings() {
  const [name, setName] = createSignal('')
  const [baseUrl, setBaseUrl] = createSignal('https://api.openai.com/v1')
  const [apiKey, setApiKey] = createSignal('')
  const [model, setModel] = createSignal('')
  const [showKey, setShowKey] = createSignal(false)
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [submitting, setSubmitting] = createSignal(false)
  const [success, setSuccess] = createSignal('')
  const [fetching, setFetching] = createSignal(false)
  const [fetchError, setFetchError] = createSignal('')
 const [availableModels, setAvailableModels] = createSignal<string[]>([])
 const [selectedModels, setSelectedModels] = createSignal<string[]>([])

  // 表单草稿：关闭弹窗后保留，下次打开恢复
  let draftLoaded = false
  let saveTimer: number | undefined = undefined
  onMount(async () => {
    try {
      const d = await loadSettingsDraft()
      if (d) {
        if (typeof d.name === 'string') setName(d.name)
        if (typeof d.baseUrl === 'string' && d.baseUrl) setBaseUrl(d.baseUrl)
        if (typeof d.apiKey === 'string') setApiKey(d.apiKey)
        if (typeof d.model === 'string') setModel(d.model)
        if (Array.isArray(d.availableModels)) setAvailableModels(d.availableModels.filter((x) => typeof x === 'string'))
        if (Array.isArray(d.selectedModels)) setSelectedModels(d.selectedModels.filter((x) => typeof x === 'string'))
      }
    } catch {}
    draftLoaded = true
  })
  const scheduleSave = () => {
    if (!draftLoaded) return
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void saveSettingsDraft({
        name: name(),
        baseUrl: baseUrl(),
        apiKey: apiKey(),
        model: model(),
        availableModels: availableModels(),
        selectedModels: selectedModels(),
      })
    }, 120)
  }
  createEffect(() => { name(); scheduleSave() })
  createEffect(() => { baseUrl(); scheduleSave() })
  createEffect(() => { apiKey(); scheduleSave() })
  createEffect(() => { model(); scheduleSave() })
  createEffect(() => { availableModels(); scheduleSave() })
  createEffect(() => { selectedModels(); scheduleSave() })
  onCleanup(() => {
    clearTimeout(saveTimer)
    void saveSettingsDraft({
      name: name(),
      baseUrl: baseUrl(),
      apiKey: apiKey(),
      model: model(),
      availableModels: availableModels(),
      selectedModels: selectedModels(),
    })
  })

 const validate = () => {
 const e: Record<string, string> = {}
 if (!name().trim()) e.name = '请输入配置名称'
 if (!baseUrl().trim()) e.baseUrl = '请输入接口地址'
 else {
 try {
 const u = new URL(baseUrl().trim())
 if (!u.protocol.startsWith('http')) e.baseUrl = '请输入合法的 URL'
 } catch {
 e.baseUrl = '请输入合法的 URL'
 }
 }
 const pending = selectedModels()
 const manual = model().trim()
 if (pending.length === 0 && !manual) e.model = '请选择至少一个模型（点 tag 选中）或输入自定义后点添加'
 setErrors(e)
 return Object.keys(e).length === 0
 }

 const onToggleTag = (m: string) => {
 const cur = selectedModels()
 if (cur.includes(m)) setSelectedModels(cur.filter((x) => x !== m))
 else {
 setSelectedModels([...cur, m])
 setErrors((p) => {
 const n = { ...p }
 delete n.model
 return n
 })
 }
 }

 const onAddCustom = () => {
 const m = model().trim()
 if (!m) {
 setErrors((p) => ({ ...p, model: '请输入自定义模型名称' }))
 return
 }
 // 去重：已在远端或已选中则仅选中
 if (!availableModels().includes(m)) {
 setAvailableModels((prev) => [...prev, m])
 }
 if (!selectedModels().includes(m)) {
 setSelectedModels((prev) => [...prev, m])
 }
 setModel('')
 setErrors((p) => {
 const n = { ...p }
 delete n.model
 return n
 })
 }



 const onSubmit = async () => {
 setSuccess('')
 if (!validate()) return
 setSubmitting(true)
 try {
 const list = [...selectedModels()]
 const manual = model().trim()
 if (manual && !list.includes(manual)) list.push(manual)
 const created = await addSource({
 name: name().trim(),
 baseUrl: baseUrl().trim().replace(/\/$/, ''),
 apiKey: apiKey().trim(),
 models: list,
 activeModel: list[0]!,
 })
 await setActiveModel(created.id)
 setSuccess(`已添加 ${name().trim()} · ${list.length} 个模型 · 已设为当前`)
 setName('')
 setApiKey('')
 setModel('')
 setAvailableModels([])
 setSelectedModels([])
 setErrors({})
 } finally {
 setSubmitting(false)
 }
 }
 const onFetchModels = async () => {
 setFetchError('')
 const base = baseUrl().trim().replace(/\/$/, '')
 if (!base) {
 setErrors((p) => ({ ...p, baseUrl: '请输入接口地址' }))
 return
 }
 try {
 new URL(base)
 } catch {
 setErrors((p) => ({ ...p, baseUrl: '请输入合法的 URL' }))
 return
 }
 setFetching(true)
 try {
   const list = await listModelsViaSDK(base, apiKey().trim())
   setAvailableModels(list)
 } catch (err) {
   const msg = err instanceof Error ? err.message : '获取失败'
   setFetchError(msg.length > 120 ? `${msg.slice(0, 120)}...` : msg)
   setAvailableModels([])
 } finally {
   setFetching(false)
 }
}

 const onRemoveModelFromSource = async (sourceId: string, modelName: string) => {
 const src = models().find((s) => s.id === sourceId)
 if (!src) return
 if (src.models.length <= 1) {
 await removeSource(sourceId)
 return
 }
 const next = src.models.filter((m) => m !== modelName)
 const nextActive = src.activeModel === modelName ? next[0]! : src.activeModel
 await updateSource(sourceId, { models: next, activeModel: nextActive })
 }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
      <div class="n-layout-content__header">
        <div class="n-layout-content__title">模型配置</div>
      </div>

      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">已配置源</span>
        </div>
        <div class="n-card__content">
          <Show
            when={models().length > 0}
            fallback={
              <div class="n-empty">
                <div class="n-empty__icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 8V4H8" />
                    <rect width="16" height="12" x="4" y="8" rx="2" />
                    <path d="M2 14h2" />
                    <path d="M20 14h2" />
                    <path d="M15 13v2" />
                    <path d="M9 13v2" />
                  </svg>
                </div>
                <div class="n-empty__desc">暂无源，在下方添加</div>
              </div>
            }
          >
            <div class="n-model-list">
              <For each={models()}>
                {(s) => (
                  <div
                    class="n-model-item"
                    style={
                      s.id === activeModelId()
                        ? { 'border-color': 'var(--n-primary)', background: 'var(--n-active-bg)' }
                        : {}
                    }
                  >
                    <div class="n-model-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="4" />
                        <path d="M8 9h8" />
                        <path d="M8 13h6" />
                        <path d="M8 17h4" />
                      </svg>
                    </div>
                    <div class="n-model-item__main" style={{ flex: '1', 'min-width': '0' }}>
                      <div class="n-model-item__name">
                        {s.name}
                        <Show when={s.id === activeModelId()}>
                          <span style={{ 'margin-left': '6px', 'font-size': '11px', color: 'var(--n-primary)', background: '#fff', border: '1px solid var(--n-primary)', padding: '1px 5px', 'border-radius': '10px' }}>
                            当前源
                          </span>
                        </Show>
                      </div>
                      <div class="n-model-item__meta" style={{ 'word-break': 'break-all' }}>
                        {s.baseUrl} · {maskKey(s.apiKey)} · {s.models.length} 模型
                      </div>
                      <div class="n-model-tags" style={{ 'margin-top': '8px', gap: '6px' }}>
                        <For each={s.models}>
                          {(m) => (
                            <span style={{ display: 'inline-flex', 'align-items': 'center', gap: '4px' }}>
                              <button
                                type="button"
                                class={`n-tag ${m === s.activeModel ? 'n-tag--active' : ''}`}
                                onClick={() => setActiveModelForSource(s.id, m)}
                                title={m === s.activeModel ? '当前模型' : '点击设为当前'}
                              >
                                {m}
                                <Show when={m === s.activeModel}>
                                  <span style={{ 'margin-left': '4px', 'font-size': '10px' }}>●</span>
                                </Show>
                              </button>
                              <button
                                type="button"
                                class="n-icon-btn"
                                style={{ width: '18px', height: '18px' }}
                                onClick={() => onRemoveModelFromSource(s.id, m)}
                                title="移除该模型"
                                aria-label="移除模型"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="n-model-item__actions" style={{ 'flex-direction': 'column', gap: '6px' }}>
                      <Show when={s.id !== activeModelId()}>
                        <button class="n-button" type="button" onClick={() => setActiveModel(s.id)}>
                          选用此源
                        </button>
                      </Show>
                      <button class="n-button n-button--error" type="button" onClick={() => removeSource(s.id)}>
                        删除源
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      <div class="n-card n-card--bordered">
        <div class="n-card-header">
          <span class="n-card-header__title">添加源</span>
        </div>
        <div class="n-card__content">
          <div class="n-form">
            <div class="n-form-item">
              <div class="n-form-item__label n-form-item__label--required">源名称</div>
              <div class="n-form-item__content">
                <div class={`n-input ${errors().name ? 'n-input--error' : ''}`}>
                  <input
                    class="n-input__input"
                    placeholder="例如：OpenAI / 本地 vLLM"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </div>
                <Show when={errors().name}>
                  <div class="n-form-item__feedback">{errors().name}</div>
                </Show>
              </div>
            </div>

            <div class="n-form-item">
              <div class="n-form-item__label n-form-item__label--required">接口地址</div>
              <div class="n-form-item__content">
                <div class={`n-input ${errors().baseUrl ? 'n-input--error' : ''}`}>
                  <input
                    class="n-input__input"
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl()}
                    onInput={(e) => setBaseUrl(e.currentTarget.value)}
                  />
                </div>
                <Show when={errors().baseUrl}>
                  <div class="n-form-item__feedback">{errors().baseUrl}</div>
                </Show>
              </div>
            </div>

            <div class="n-form-item">
              <div class="n-form-item__label">API Key</div>
              <div class="n-form-item__content">
                <div class="n-input">
                  <input
                    class="n-input__input"
                    type={showKey() ? 'text' : 'password'}
                    placeholder="可留空，本地模型可忽略"
                    value={apiKey()}
                    onInput={(e) => setApiKey(e.currentTarget.value)}
                  />
                  <div class="n-input__suffix">
                    <button type="button" onClick={() => setShowKey(!showKey())} aria-label="切换显示">
                      <Show
                        when={!showKey()}
                        fallback={
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        }
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 8 11 8a9.59 9.59 0 0 0 3-0.39" />
                          <line x1="2" y1="2" x2="22" y2="22" />
                        </svg>
                      </Show>
                    </button>
                  </div>
                </div>
              </div>
            </div>

 <div class="n-form-item">
 <div class="n-form-item__label n-form-item__label--required">模型</div>
 <div class="n-form-item__content">
 <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
 <div class={`n-input ${errors().model ? 'n-input--error' : ''}`} style={{ flex: '1' }}>
 <input
 class="n-input__input"
 placeholder="输入自定义模型（可选），回车或点添加"
 value={model()}
 onInput={(e) => setModel(e.currentTarget.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') {
 e.preventDefault()
 onAddCustom()
 }
 }}
 />
 </div>
 <button type="button" class="n-button" onClick={onAddCustom} style={{ 'white-space': 'nowrap' }}>
 添加
 </button>
 <button type="button" class="n-button" onClick={onFetchModels} disabled={fetching()} style={{ 'white-space': 'nowrap' }}>
 {fetching() ? '获取中...' : '获取模型'}
 </button>
 </div>
 <Show when={errors().model}>
 <div class="n-form-item__feedback">{errors().model}</div>
 </Show>
 <Show when={fetchError()}>
 <div class="n-alert n-alert--error" style={{ 'margin-top': '6px' }}>{fetchError()}</div>
 </Show>
 <Show when={availableModels().length > 0}>
 <div style={{ 'margin-top': '10px', border: '1px solid var(--n-divider)', 'border-radius': '8px', padding: '8px', background: '#fafafb' }}>
 <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '6px' }}>
<span style={{ 'font-size': '11px', color: 'var(--n-text-1)', 'font-weight': '600' }}>
点选加入（{selectedModels().length}/{availableModels().length}）
</span>
 <Show when={selectedModels().length > 0}>
 <button type="button" class="n-button" style={{ height: '20px', padding: '0 6px', 'font-size': '11px' }} onClick={() => setSelectedModels([])}>
 清空选择
 </button>
 </Show>
 </div>
 <div class="n-model-tags" style={{ gap: '6px' }}>
 <For each={availableModels()}>
 {(m) => (
 <button
 type="button"
 class={`n-tag ${selectedModels().includes(m) ? 'n-tag--active' : ''}`}
 onClick={() => onToggleTag(m)}
 title={selectedModels().includes(m) ? '已选中，再点取消' : '点选中加入'}
 style={{ 'font-size': '12px' }}
 >
 {m}
 </button>
 )}
 </For>
 </div>
 </div>
 </Show>
<Show when={availableModels().length === 0}>
<div style={{ 'font-size': '11px', color: 'var(--n-text-3)', 'margin-top': '8px' }}>
点“获取模型”拉取，或输入自定义模型后点“添加”
</div>
</Show>
 </div>
 </div>

 <Show when={success()}>
 <div class="n-alert n-alert--success">{success()}</div>
 </Show>

 <div style={{ display: 'flex', 'justify-content': 'flex-end', 'padding-top': '4px' }}>
 <button class="n-button n-button--primary" type="button" onClick={onSubmit} disabled={submitting()}>
 {submitting() ? '添加中...' : `添加源${selectedModels().length ? `（${selectedModels().length} 模型）` : ''}`}
 </button>
 </div>
 </div>
 </div>
 </div>
 </div>
 )
}

