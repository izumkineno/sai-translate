import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  description: '大模型翻译插件',
  icons: {
    16: 'src/assets/32x32.png',
    32: 'src/assets/32x32.png',
    48: 'src/assets/32x32.png',
    128: 'src/assets/128x128.png',
  },
  action: {
    default_icon: {
      16: 'src/assets/32x32.png',
      32: 'src/assets/32x32.png',
      48: 'src/assets/32x32.png',
      128: 'src/assets/128x128.png',
    },
    default_popup: 'src/popup/index.html',
  },
  permissions: ['storage', 'activeTab', 'tabs', 'webRequest'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      js: ['src/content/main.ts'],
      matches: ['<all_urls>'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  commands: {
    'translate-selection': {
      suggested_key: { default: 'Alt+Shift+T', mac: 'Alt+Shift+T' },
      description: '翻译选中/悬停块并行下展示',
    },
    'translate-selection-only': {
      suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
      description: '仅翻译选中文本（翻译窗口）',
    },
    'toggle-inline': {
      suggested_key: { default: 'Alt+Shift+Y', mac: 'Alt+Shift+Y' },
      description: '显示/隐藏译文',
    },
  },
})
