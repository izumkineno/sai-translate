// Content script entry — hover preselection + shortcut + Shadow DOM injection
import { initHover } from './hover'
import { initShortcut } from './shortcut'

console.log('[sai-translate] content loaded')

// Guard: skip chrome:// etc (MV3 already prevents, but double-check)
if (location.protocol.startsWith('chrome') || location.protocol.startsWith('edge') || location.hostname.includes('chrome.google.com')) {
  console.log('[sai-translate] skip privileged page')
} else {
  try {
    initHover()
    initShortcut()
  } catch (e) {
    console.error('[sai-translate] content init failed', e)
  }
}

// SPA navigation — use history patch instead of polling
let lastUrl = location.href
const fireNav = () => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    window.dispatchEvent(new CustomEvent('sai:clearHover'))
  }
}
const origPush = history.pushState
const origReplace = history.replaceState
history.pushState = function (...args: Parameters<typeof history.pushState>) {
  const ret = origPush.apply(this, args as never)
  fireNav()
  return ret
}
history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
  const ret = origReplace.apply(this, args as never)
  fireNav()
  return ret
}
window.addEventListener('popstate', fireNav)
window.addEventListener('hashchange', fireNav)
