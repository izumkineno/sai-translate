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
  permissions: ['storage'],
  host_permissions: ['https://*/*', 'http://*/*'],
})
