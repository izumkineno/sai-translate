import { createSignal } from 'solid-js'

export type HoverIconPosition = 'top-right' | 'bottom-right'

export type HoverConfig = {
  hoverEnabled: boolean
  hoverHighlight: boolean
  hoverIcon: boolean
  hoverDashed: boolean
  hoverHighlightColor: string
  hoverDashedColor: string
  hoverDashedWidth: number
  hoverIconPosition: HoverIconPosition
  hoverExcludeSelectors: string
  inlineEnabled: boolean
  targetLang: string
  shortcutKey: string
}

export const DEFAULT_HOVER_CONFIG: HoverConfig = {
 hoverEnabled: true,
 hoverHighlight: true,
 hoverIcon: true,
 hoverDashed: true,
 hoverHighlightColor: '#fef08a',
 hoverDashedColor: '#e5e7eb',
 hoverDashedWidth: 1,
 hoverIconPosition: 'top-right',
 hoverExcludeSelectors: 'pre,code,[contenteditable]',
 inlineEnabled: true,
 targetLang: '中文',
 shortcutKey: 'KeyQ',
}

// Keep alias for convenience / backwards compat with spec wording
export const defaults = DEFAULT_HOVER_CONFIG

// Storage key mapping — must match spec exactly
export const STORAGE_KEYS = {
  hoverEnabled: 'sai_hover_enabled',
  hoverHighlight: 'sai_hover_highlight',
  hoverIcon: 'sai_hover_icon',
  hoverDashed: 'sai_hover_dashed',
  hoverHighlightColor: 'sai_hover_highlight_color',
  hoverDashedColor: 'sai_hover_dashed_color',
  hoverDashedWidth: 'sai_hover_dashed_width',
  hoverIconPosition: 'sai_hover_icon_position',
  hoverExcludeSelectors: 'sai_hover_exclude_selectors',
  inlineEnabled: 'sai_translate_inline_enabled',
  targetLang: 'sai_translate_target_lang',
  shortcutKey: 'sai_translate_shortcut_key',
} as const

// Also export individual key constants for direct chrome.storage access (content/background)
export const HOVER_ENABLED_KEY = STORAGE_KEYS.hoverEnabled
export const HOVER_HIGHLIGHT_KEY = STORAGE_KEYS.hoverHighlight
export const HOVER_ICON_KEY = STORAGE_KEYS.hoverIcon
export const HOVER_DASHED_KEY = STORAGE_KEYS.hoverDashed
export const HOVER_HIGHLIGHT_COLOR_KEY = STORAGE_KEYS.hoverHighlightColor
export const HOVER_DASHED_COLOR_KEY = STORAGE_KEYS.hoverDashedColor
export const HOVER_DASHED_WIDTH_KEY = STORAGE_KEYS.hoverDashedWidth
export const HOVER_ICON_POSITION_KEY = STORAGE_KEYS.hoverIconPosition
export const HOVER_EXCLUDE_SELECTORS_KEY = STORAGE_KEYS.hoverExcludeSelectors
export const INLINE_ENABLED_KEY = STORAGE_KEYS.inlineEnabled
export const TARGET_LANG_KEY = STORAGE_KEYS.targetLang
export const SHORTCUT_KEY = STORAGE_KEYS.shortcutKey

export function getChromeStorage(): chrome.storage.StorageArea | null {
  try {
    const g = globalThis as unknown as { chrome?: { storage?: { local?: chrome.storage.StorageArea } } }
    return g.chrome?.storage?.local ?? null
  } catch {
    return null
  }
}

function parseBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function parseString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function parseNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function parseIconPosition(v: unknown, fallback: HoverIconPosition): HoverIconPosition {
  return v === 'top-right' || v === 'bottom-right' ? v : fallback
}

const ALL_KEYS = Object.values(STORAGE_KEYS)

// Per-field signals — exported individually as requested
const [hoverEnabled, setHoverEnabled] = createSignal<boolean>(DEFAULT_HOVER_CONFIG.hoverEnabled)
const [hoverHighlight, setHoverHighlight] = createSignal<boolean>(DEFAULT_HOVER_CONFIG.hoverHighlight)
const [hoverIcon, setHoverIcon] = createSignal<boolean>(DEFAULT_HOVER_CONFIG.hoverIcon)
const [hoverDashed, setHoverDashed] = createSignal<boolean>(DEFAULT_HOVER_CONFIG.hoverDashed)
const [hoverHighlightColor, setHoverHighlightColor] = createSignal<string>(DEFAULT_HOVER_CONFIG.hoverHighlightColor)
const [hoverDashedColor, setHoverDashedColor] = createSignal<string>(DEFAULT_HOVER_CONFIG.hoverDashedColor)
const [hoverDashedWidth, setHoverDashedWidth] = createSignal<number>(DEFAULT_HOVER_CONFIG.hoverDashedWidth)
const [hoverIconPosition, setHoverIconPosition] = createSignal<HoverIconPosition>(DEFAULT_HOVER_CONFIG.hoverIconPosition)
const [hoverExcludeSelectors, setHoverExcludeSelectors] = createSignal<string>(DEFAULT_HOVER_CONFIG.hoverExcludeSelectors)
const [inlineEnabled, setInlineEnabled] = createSignal<boolean>(DEFAULT_HOVER_CONFIG.inlineEnabled)
const [targetLang, setTargetLang] = createSignal<string>(DEFAULT_HOVER_CONFIG.targetLang)
const [shortcutKey, setShortcutKey] = createSignal<string>(DEFAULT_HOVER_CONFIG.shortcutKey)

// Combined signal helper — returns snapshot of all fields
function getHoverConfig(): HoverConfig {
  return {
    hoverEnabled: hoverEnabled(),
    hoverHighlight: hoverHighlight(),
    hoverIcon: hoverIcon(),
    hoverDashed: hoverDashed(),
    hoverHighlightColor: hoverHighlightColor(),
    hoverDashedColor: hoverDashedColor(),
    hoverDashedWidth: hoverDashedWidth(),
    hoverIconPosition: hoverIconPosition(),
    hoverExcludeSelectors: hoverExcludeSelectors(),
    inlineEnabled: inlineEnabled(),
    targetLang: targetLang(),
    shortcutKey: shortcutKey(),
  }
}

// For compatibility with "signal" naming, also export a getter named hoverConfig
const hoverConfig = getHoverConfig

let loaded = false

function applyRaw(raw: Record<string, unknown>) {
  setHoverEnabled(parseBoolean(raw[STORAGE_KEYS.hoverEnabled], DEFAULT_HOVER_CONFIG.hoverEnabled))
  setHoverHighlight(parseBoolean(raw[STORAGE_KEYS.hoverHighlight], DEFAULT_HOVER_CONFIG.hoverHighlight))
  setHoverIcon(parseBoolean(raw[STORAGE_KEYS.hoverIcon], DEFAULT_HOVER_CONFIG.hoverIcon))
  setHoverDashed(parseBoolean(raw[STORAGE_KEYS.hoverDashed], DEFAULT_HOVER_CONFIG.hoverDashed))
  setHoverHighlightColor(parseString(raw[STORAGE_KEYS.hoverHighlightColor], DEFAULT_HOVER_CONFIG.hoverHighlightColor))
  setHoverDashedColor(parseString(raw[STORAGE_KEYS.hoverDashedColor], DEFAULT_HOVER_CONFIG.hoverDashedColor))
  setHoverDashedWidth(parseNumber(raw[STORAGE_KEYS.hoverDashedWidth], DEFAULT_HOVER_CONFIG.hoverDashedWidth))
  setHoverIconPosition(parseIconPosition(raw[STORAGE_KEYS.hoverIconPosition], DEFAULT_HOVER_CONFIG.hoverIconPosition))
  setHoverExcludeSelectors(parseString(raw[STORAGE_KEYS.hoverExcludeSelectors], DEFAULT_HOVER_CONFIG.hoverExcludeSelectors))
  setInlineEnabled(parseBoolean(raw[STORAGE_KEYS.inlineEnabled], DEFAULT_HOVER_CONFIG.inlineEnabled))
  setTargetLang(parseString(raw[STORAGE_KEYS.targetLang], DEFAULT_HOVER_CONFIG.targetLang))
  setShortcutKey(parseString(raw[STORAGE_KEYS.shortcutKey], DEFAULT_HOVER_CONFIG.shortcutKey))
}

export async function loadHoverConfig(): Promise<HoverConfig> {
  if (loaded) return getHoverConfig()
  loaded = true
  const storage = getChromeStorage()
  if (storage) {
    try {
      const res = await storage.get(ALL_KEYS)
      applyRaw(res as Record<string, unknown>)
      return getHoverConfig()
    } catch {}
  }
  // fallback: localStorage per-key (for dev / tests)
  try {
    const raw: Record<string, unknown> = {}
    for (const k of ALL_KEYS) {
      const v = localStorage.getItem(k)
      if (v !== null) {
        try {
          raw[k] = JSON.parse(v)
        } catch {
          raw[k] = v
        }
      }
    }
    if (Object.keys(raw).length > 0) applyRaw(raw)
  } catch {}
  return getHoverConfig()
}

// Alias required by some specs
export const load = loadHoverConfig

function toStorageRecord(cfg: HoverConfig): Record<string, unknown> {
  return {
    [STORAGE_KEYS.hoverEnabled]: cfg.hoverEnabled,
    [STORAGE_KEYS.hoverHighlight]: cfg.hoverHighlight,
    [STORAGE_KEYS.hoverIcon]: cfg.hoverIcon,
    [STORAGE_KEYS.hoverDashed]: cfg.hoverDashed,
    [STORAGE_KEYS.hoverHighlightColor]: cfg.hoverHighlightColor,
    [STORAGE_KEYS.hoverDashedColor]: cfg.hoverDashedColor,
    [STORAGE_KEYS.hoverDashedWidth]: cfg.hoverDashedWidth,
    [STORAGE_KEYS.hoverIconPosition]: cfg.hoverIconPosition,
    [STORAGE_KEYS.hoverExcludeSelectors]: cfg.hoverExcludeSelectors,
    [STORAGE_KEYS.inlineEnabled]: cfg.inlineEnabled,
    [STORAGE_KEYS.targetLang]: cfg.targetLang,
    [STORAGE_KEYS.shortcutKey]: cfg.shortcutKey,
  }
}

function patchToRecord(patch: Partial<HoverConfig>): Record<string, unknown> {
  const rec: Record<string, unknown> = {}
  if (patch.hoverEnabled !== undefined) rec[STORAGE_KEYS.hoverEnabled] = patch.hoverEnabled
  if (patch.hoverHighlight !== undefined) rec[STORAGE_KEYS.hoverHighlight] = patch.hoverHighlight
  if (patch.hoverIcon !== undefined) rec[STORAGE_KEYS.hoverIcon] = patch.hoverIcon
  if (patch.hoverDashed !== undefined) rec[STORAGE_KEYS.hoverDashed] = patch.hoverDashed
  if (patch.hoverHighlightColor !== undefined) rec[STORAGE_KEYS.hoverHighlightColor] = patch.hoverHighlightColor
  if (patch.hoverDashedColor !== undefined) rec[STORAGE_KEYS.hoverDashedColor] = patch.hoverDashedColor
  if (patch.hoverDashedWidth !== undefined) rec[STORAGE_KEYS.hoverDashedWidth] = patch.hoverDashedWidth
  if (patch.hoverIconPosition !== undefined) rec[STORAGE_KEYS.hoverIconPosition] = patch.hoverIconPosition
  if (patch.hoverExcludeSelectors !== undefined) rec[STORAGE_KEYS.hoverExcludeSelectors] = patch.hoverExcludeSelectors
  if (patch.inlineEnabled !== undefined) rec[STORAGE_KEYS.inlineEnabled] = patch.inlineEnabled
  if (patch.targetLang !== undefined) rec[STORAGE_KEYS.targetLang] = patch.targetLang
  if (patch.shortcutKey !== undefined) rec[STORAGE_KEYS.shortcutKey] = patch.shortcutKey
  return rec
}

export async function persistHoverConfig(cfg?: HoverConfig): Promise<void> {
  const toPersist = cfg ?? getHoverConfig()
  const rec = toStorageRecord(toPersist)
  const storage = getChromeStorage()
  if (storage) {
    try {
      await storage.set(rec)
      return
    } catch {}
  }
  try {
    for (const [k, v] of Object.entries(rec)) {
      localStorage.setItem(k, JSON.stringify(v))
    }
  } catch {}
}

export const persist = persistHoverConfig

function applyPatchToSignals(patch: Partial<HoverConfig>) {
  if (patch.hoverEnabled !== undefined) setHoverEnabled(patch.hoverEnabled)
  if (patch.hoverHighlight !== undefined) setHoverHighlight(patch.hoverHighlight)
  if (patch.hoverIcon !== undefined) setHoverIcon(patch.hoverIcon)
  if (patch.hoverDashed !== undefined) setHoverDashed(patch.hoverDashed)
  if (patch.hoverHighlightColor !== undefined) setHoverHighlightColor(patch.hoverHighlightColor)
  if (patch.hoverDashedColor !== undefined) setHoverDashedColor(patch.hoverDashedColor)
  if (patch.hoverDashedWidth !== undefined) setHoverDashedWidth(patch.hoverDashedWidth)
  if (patch.hoverIconPosition !== undefined) setHoverIconPosition(patch.hoverIconPosition)
  if (patch.hoverExcludeSelectors !== undefined) setHoverExcludeSelectors(patch.hoverExcludeSelectors)
  if (patch.inlineEnabled !== undefined) setInlineEnabled(patch.inlineEnabled)
  if (patch.targetLang !== undefined) setTargetLang(patch.targetLang)
  if (patch.shortcutKey !== undefined) setShortcutKey(patch.shortcutKey)
}

export async function updateHoverConfig(patch: Partial<HoverConfig>): Promise<HoverConfig> {
  // ensure initial load happened
  if (!loaded) await loadHoverConfig()
  applyPatchToSignals(patch)
  const rec = patchToRecord(patch)
  if (Object.keys(rec).length === 0) return getHoverConfig()
  const storage = getChromeStorage()
  if (storage) {
    try {
      await storage.set(rec)
      return getHoverConfig()
    } catch {}
  }
  try {
    for (const [k, v] of Object.entries(rec)) {
      localStorage.setItem(k, JSON.stringify(v))
    }
  } catch {}
  return getHoverConfig()
}

export async function setHoverConfig(patch: Partial<HoverConfig>): Promise<HoverConfig> {
  return updateHoverConfig(patch)
}

export async function resetHoverConfig(): Promise<HoverConfig> {
  const cfg = { ...DEFAULT_HOVER_CONFIG }
  // update signals
  applyPatchToSignals(cfg)
  await persistHoverConfig(cfg)
  return getHoverConfig()
}

// Auto load on import (non-blocking) — mirrors models.ts
loadHoverConfig()

export function useHoverConfig() {
  return {
    hoverConfig,
    getHoverConfig,
    hoverEnabled,
    hoverHighlight,
    hoverIcon,
    hoverDashed,
    hoverHighlightColor,
    hoverDashedColor,
    hoverDashedWidth,
    hoverIconPosition,
    hoverExcludeSelectors,
    inlineEnabled,
    targetLang,
    shortcutKey,
    loadHoverConfig,
    load,
    persistHoverConfig,
    persist,
    updateHoverConfig,
    setHoverConfig,
    resetHoverConfig,
    defaults: DEFAULT_HOVER_CONFIG,
  }
}

// Re-export individual signals for direct import
export {
  hoverEnabled,
  setHoverEnabled,
  hoverHighlight,
  setHoverHighlight,
  hoverIcon,
  setHoverIcon,
  hoverDashed,
  setHoverDashed,
  hoverHighlightColor,
  setHoverHighlightColor,
  hoverDashedColor,
  setHoverDashedColor,
  hoverDashedWidth,
  setHoverDashedWidth,
  hoverIconPosition,
  setHoverIconPosition,
  hoverExcludeSelectors,
  setHoverExcludeSelectors,
  inlineEnabled,
  setInlineEnabled,
  targetLang,
  setTargetLang,
  shortcutKey,
  setShortcutKey,
  hoverConfig,
  getHoverConfig,
}
