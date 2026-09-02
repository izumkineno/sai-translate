# 05 — Background、Content Scripts 与 HMR 原理

> 来源：`concepts/02-background.md`、`concepts/03-content-scripts.md`、`getting-started/solid/02-add-content-script.md`、`getting-started/solid/03-dev-content-script.md`、`src/node/plugin-background.ts`、`plugin-hmr.ts`、`plugin-contentScripts*.ts`、`fileWriter.ts`、`contentScripts.ts`、`virtualFileIds.ts`

## 1. Background Service Worker

### 声明

```json
{ "background": { "service_worker": "src/background.ts", "type": "module" } }
```

CRXJS 强制 `type: "module"`（Vite 产出 ESM，见 `02-background.md`）。

### 开发期 loader 机制（`plugin-background.ts` 最长注释）

Service Worker 只能拦截**自身作用域**内的请求，因此 CRXJS 在扩展根目录生成 `service-worker-loader.js`，内容形如（Chrome）：

```js
import 'http://localhost:5173/@vite/env';
import 'http://localhost:5173/@crx/content-script-loader'; // workerClientId
import 'http://localhost:5173/src/background.ts';
```

生产期则简化为 `import './src/background.ts.js'`。`pluginBackground` 通过 `renderCrxManifest` 将 `manifest.background.service_worker` 重写为该 loader 文件名（`getFileName({ type: 'loader', id: 'service-worker' })`），并用 `handleHotUpdate` 在后台文件变动时**带时间戳**重写 loader 以触发重载。

Firefox 分支：输出 `background.scripts: [loader]` 且三条 `import()` 拆为动态 `import()`，因其后台为 page 而非 worker。

### HMR 行为

- 后台改动 → `plugin-hmr#handleHotUpdate` 检测 `isImporter(background)` → `server.ws.send({ type: 'custom', event: 'crx:runtime-reload' })` → 扩展整体重载（`chrome.runtime.reload()` 由 worker HMR 客户端执行）
- `liveReload: false` 可关闭自动重载（`types.ts#CrxOptions`）

## 2. Content Scripts

### Manifest 声明（`02-add-content-script.md`）

```json
{
  "content_scripts": [{
    "js": ["src/content/main.ts"],
    "matches": ["https://*/*"],
    "run_at": "document_idle", // 可选
    "world": "ISOLATED"        // 默认，见下
  }]
}
```

### 挂载模式（本模板 `src/content/main.ts`）

Content script **没有 HTML**，需自建容器：

```ts
import { createComponent } from 'solid-js'
import { render } from 'solid-js/web'
import App from './views/App.tsx'

function mountApp() {
  const container = document.createElement('div')
  container.id = 'crxjs-app'
  document.body.appendChild(container)
  render(() => createComponent(App, {}), container)
}
mountApp()
```

各框架对比（`getting-started/**/02-add-content-script.md`）：

| 框架 | 挂载 API | 容器 |
|---|---|---|
| Solid | `render(() => <App />, root)` | `document.createElement('div')` |
| React 18 | `ReactDOM.createRoot(root).render(<App />)` | 同上 |
| Vue | `createApp(App).mount(root)` | 同上 |
| Vanilla | `DOMParser + append` | 同上 |

### CSS 泄漏与隔离（`03-dev-content-script.md#Leaking CSS styles`）

> 宿主页面 CSS 会影响 content script，反之亦然。

官方修复建议：给容器加高特异性选择器

```css
#crx-root { position: fixed; top: 3rem; left: 50%; transform: translate(-50%,0); }
#crx-root button { /* 显式重置 */ }
```

更彻底方案：Shadow DOM（需自行封装，CRXJS 不强制）。

### World

- `ISOLATED`（默认）：与页面 JS 隔离，可用 `chrome.*`，**支持 HMR**
- `MAIN`：与页面同 world，无隔离，可访问页面全局变量，**当前不支持 HMR**（`defineManifest.ts` 注释 `NOTE: MAIN currently does NOT support crxjs HMR`），2.7.0 后通过 IIFE 路径有限支持

### IIFE 自包含脚本

两种触发：

1. 文件名含 `.iife.ts`（如 `src/injected.iife.ts`）
2. `crx({ contentScripts: { standaloneFiles: ['src/injected.ts'] } })`

由 `pluginContentScriptsIife.ts` 在构建期合并为单文件 IIFE（所有依赖内联），适用于 `chrome.scripting.executeScript` / `registerContentScripts` 的 `MAIN` world 注入（`CHANGELOG 2.6.0`）。

## 3. HMR 完整链路

```
Vite watcher → plugin-hmr#handleHotUpdate
  ├─ background 依赖？ → ws.send(crx:runtime-reload) → worker 重载
  ├─ content script 依赖？ → fileWriter.update(id) → Rollup 增量打包 → 输出到 dist/ → dev-loader 轮询 → host 页面 HMR 应用
  │     ├─ 普通 module：isImporter 判断
  │     ├─ CSS：pluginContentScripts_declared 的 synthetic 虚拟模块（getContentCssEntries / isContentCssId）
  │     ├─ 虚拟模块（如 UnoCSS __uno.css）：走 /@id/__x00__ 分支
  │     └─ IIFE：额外匹配 scriptPath，rebuild 后再 runtime-reload
  └─ popup/sidepanel HTML/CSS：Vite 原生 HMR（plugin-hmr 仅装饰 ws.send，正常透传）
```

关键文件：

- `fileWriter.ts`：`start(server)` 以 Rollup 二次打包 CRX base；`update(id)` 队列化写入；`write(fileId)` 等待 `start$` 事件后 `outputFile`
- `fileWriter-rxjs.ts`：`hmrPayload$` / `crxHMRPayload$` / `fileWriterError$` 三条 RxJS 流
- `contentScripts.ts`：`RxMap<string, ContentScript>` 多键映射（id / refId / fileName / loaderName / scriptId ...）
- `plugin-hmr.ts#renderCrxDevScript`：重写 `createHotContext("/src/...")` 为 `createHotContext("/assets/content-xxx.js")` 以对齐输出路径

### 调试技巧

- 开发期 `dist/` 下可看到 `content-dev-loader.ts`/`content-dev-main-loader.ts` 生成的 loader
- 控制台出现 `[vite] hot updated: /src/content.css` 即 CSS 热更成功
- 若 `liveReload: false`，控制台不再自动 reload，需手动在 `chrome://extensions` 点刷新

---

> 下一篇：`06-内部插件架构与进阶配置.md` —— 16 个子插件职责、排序与 `CrxOptions` 全量
