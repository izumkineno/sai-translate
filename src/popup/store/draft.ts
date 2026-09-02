export type Draft = {
  input: string
  output: string
  target: string
}

const DRAFT_KEY = 'sai_translate_draft'

function getStorage(): chrome.storage.StorageArea | null {
  try {
    const g = globalThis as unknown as { chrome?: { storage?: { local?: chrome.storage.StorageArea } } }
    return g.chrome?.storage?.local ?? null
  } catch {
    return null
  }
}

export async function loadDraft(): Promise<Draft | null> {
  const storage = getStorage()
  if (storage) {
    try {
      const res = await storage.get(DRAFT_KEY)
      const v = res[DRAFT_KEY] as Draft | undefined
      if (v && typeof v === 'object') return v
    } catch {}
  }
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Draft
      if (v && typeof v === 'object') return v
    }
  } catch {}
  return null
}

export async function saveDraft(draft: Draft): Promise<void> {
  const storage = getStorage()
  if (storage) {
    try {
      await storage.set({ [DRAFT_KEY]: draft })
      return
    } catch {}
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {}
}

export async function clearDraft(): Promise<void> {
  const storage = getStorage()
  if (storage) {
    try {
      await storage.remove(DRAFT_KEY)
    } catch {}
  }
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {}
}
