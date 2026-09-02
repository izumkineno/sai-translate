export type SettingsDraft = {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  availableModels: string[]
  selectedModels: string[]
}

const KEY = 'sai_translate_settings_draft'

function getStorage(): chrome.storage.StorageArea | null {
  try {
    const g = globalThis as unknown as { chrome?: { storage?: { local?: chrome.storage.StorageArea } } }
    return g.chrome?.storage?.local ?? null
  } catch {
    return null
  }
}

export async function loadSettingsDraft(): Promise<SettingsDraft | null> {
  const storage = getStorage()
  if (storage) {
    try {
      const res = await storage.get(KEY)
      const v = res[KEY] as SettingsDraft | undefined
      if (v && typeof v === 'object') return v
    } catch {}
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw) as SettingsDraft
      if (v && typeof v === 'object') return v
    }
  } catch {}
  return null
}

export async function saveSettingsDraft(draft: SettingsDraft): Promise<void> {
  const storage = getStorage()
  if (storage) {
    try {
      await storage.set({ [KEY]: draft })
      return
    } catch {}
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {}
}

export async function clearSettingsDraft(): Promise<void> {
  const storage = getStorage()
  if (storage) {
    try {
      await storage.remove(KEY)
    } catch {}
  }
  try {
    localStorage.removeItem(KEY)
  } catch {}
}
