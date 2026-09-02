import { createSignal } from 'solid-js'

export type ModelSource = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  activeModel: string
  createdAt: number
}

// legacy single-model shape for migration
type LegacyModel = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  createdAt: number
}

// alias keeps old imports working
export type Model = ModelSource

function getChromeStorage(): chrome.storage.StorageArea | null {
  try {
    const g = globalThis as unknown as { chrome?: { storage?: { local?: chrome.storage.StorageArea } } }
    return g.chrome?.storage?.local ?? null
  } catch {
    return null
  }
}

const STORAGE_KEY = 'sai_translate_models'
const ACTIVE_KEY = 'sai_translate_active_model'

const [models, setModels] = createSignal<ModelSource[]>([])
const [activeModelId, setActiveModelId] = createSignal<string | null>(null)
let loaded = false

function migrateEntry(entry: unknown): ModelSource | null {
  if (!entry || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  const id = typeof obj['id'] === 'string' ? (obj['id'] as string) : `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const name = typeof obj['name'] === 'string' ? (obj['name'] as string) : ''
  const baseUrl = typeof obj['baseUrl'] === 'string' ? (obj['baseUrl'] as string) : ''
  const apiKey = typeof obj['apiKey'] === 'string' ? (obj['apiKey'] as string) : ''
  const createdAt = typeof obj['createdAt'] === 'number' ? (obj['createdAt'] as number) : Date.now()

  // new shape
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
  // legacy shape
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

async function load() {
  if (loaded) return
  loaded = true
  const storage = getChromeStorage()
  if (storage) {
    try {
      const res = await storage.get([STORAGE_KEY, ACTIVE_KEY])
      const raw = res[STORAGE_KEY] as unknown
      if (Array.isArray(raw)) {
        const migrated = (raw as unknown[]).map(migrateEntry).filter((v): v is ModelSource => v !== null)
        // persist back if migration changed shape
        if (migrated.length !== raw.length || raw.some((e) => (e as Record<string, unknown>)['model'] !== undefined)) {
          await storage.set({ [STORAGE_KEY]: migrated })
        }
        setModels(migrated)
      }
      const active = res[ACTIVE_KEY] as string | undefined
      if (typeof active === 'string') setActiveModelId(active)
      if (!active && migratedOrFallback().length > 0) {
        // handled below
      }
      if (!active) {
        const list = migratedOrFallback()
        if (list.length > 0) setActiveModelId(list[0]!.id)
      }
      return
    } catch {}
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const migrated = (parsed as unknown[]).map(migrateEntry).filter((v): v is ModelSource => v !== null)
        setModels(migrated)
        if (migrated.length !== parsed.length || (parsed as unknown[]).some((e) => (e as Record<string, unknown>)['model'] !== undefined)) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
          } catch {}
        }
      }
    }
    const active = localStorage.getItem(ACTIVE_KEY)
    if (active) setActiveModelId(active)
    else {
      const list = models()
      if (list.length > 0) setActiveModelId(list[0]!.id)
    }
  } catch {}

  function migratedOrFallback(): ModelSource[] {
    // helper for storage branch: read current signal
    return models()
  }
}

async function persist(list: ModelSource[]) {
  const storage = getChromeStorage()
  if (storage) {
    try {
      await storage.set({ [STORAGE_KEY]: list })
      return
    } catch {}
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {}
}

async function persistActive(id: string | null) {
  const storage = getChromeStorage()
  if (storage) {
    try {
      if (id) await storage.set({ [ACTIVE_KEY]: id })
      else await storage.remove(ACTIVE_KEY)
      return
    } catch {}
  }
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {}
}

// auto load on import (async, non-blocking)
load()

export function useModels() {
  return { models, activeModelId, load, addModel, addSource, removeModel, removeSource, setActiveModel, setActiveModelForSource, updateSource }
}

export async function addSource(data: Omit<ModelSource, 'id' | 'createdAt'>): Promise<ModelSource> {
  await load()
  const list = data.models.map((m) => m.trim()).filter(Boolean)
  if (list.length === 0) throw new Error('models 不能为空')
  const active = data.activeModel.trim() && list.includes(data.activeModel.trim()) ? data.activeModel.trim() : list[0]!
  const m: ModelSource = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    name: data.name,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    models: list,
    activeModel: active,
  }
  const next = [...models(), m]
  setModels(next)
  await persist(next)
  // auto select new source
  setActiveModelId(m.id)
  await persistActive(m.id)
  return m
}

// legacy wrapper: single model -> source with one model
export async function addModel(data: Omit<LegacyModel, 'id' | 'createdAt'>): Promise<ModelSource> {
  return addSource({
    name: data.name,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    models: [data.model],
    activeModel: data.model,
  })
}

export async function removeModel(id: string): Promise<void> {
  return removeSource(id)
}

export async function removeSource(id: string): Promise<void> {
  await load()
  const next = models().filter((x) => x.id !== id)
  setModels(next)
  await persist(next)
  if (activeModelId() === id) {
    const fallback = next[0]?.id ?? null
    setActiveModelId(fallback)
    await persistActive(fallback)
  }
}

export async function setActiveModel(id: string): Promise<void> {
  await load()
  setActiveModelId(id)
  await persistActive(id)
}

export async function setActiveModelForSource(sourceId: string, modelName: string): Promise<void> {
  await load()
  const list = models()
  const idx = list.findIndex((s) => s.id === sourceId)
  if (idx === -1) return
  const src = list[idx]!
  if (!src.models.includes(modelName)) return
  if (src.activeModel === modelName) return
  const next = list.map((s) => (s.id === sourceId ? { ...s, activeModel: modelName } : s))
  setModels(next)
  await persist(next)
}

export async function updateSource(id: string, patch: Partial<Omit<ModelSource, 'id' | 'createdAt'>>): Promise<void> {
  await load()
  const list = models()
  const idx = list.findIndex((s) => s.id === id)
  if (idx === -1) return
  const src = list[idx]!
  const nextModels = patch.models ? patch.models.map((m) => m.trim()).filter(Boolean) : src.models
  if (nextModels.length === 0) throw new Error('models 不能为空')
  const nextActive = patch.activeModel && nextModels.includes(patch.activeModel) ? patch.activeModel : src.activeModel
  const fixedActive = nextModels.includes(nextActive) ? nextActive : nextModels[0]!
  const updated: ModelSource = {
    ...src,
    ...patch,
    models: nextModels,
    activeModel: fixedActive,
  }
  const next = list.map((s) => (s.id === id ? updated : s))
  setModels(next)
  await persist(next)
}

export { models, activeModelId }
