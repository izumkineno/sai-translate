# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-09-02

### Added
- **selection**: 段落级探测与句级分割 (`src/content/utils/selection.ts`) — `isBlock` / `findBlockAnchor` / `findBestBlockForRange/AtPoint` 带评分、`getBlocksInRange` (TreeWalker + range 交集去重)、`Intl.Segmenter` 句级切分、`rangeForOffsets` / `getSentenceRangeAtPoint`、`normalizeWhitespace` / `isValidText`
- **content: hover**: 悬停预选高亮与块级提示 (`src/content/hover.ts`) — Highlight API 句级高亮、块评分、图标 + 虚线轮廓、`hoverConfig` 持久化
- **content: inject**: Shadow DOM 行下注入 (`src/content/inject.ts`) — 每锚点独立 host、右下角悬浮一键关闭按钮 (`data-sai-close-all`)、`MutationObserver` 保活、`placeAfter` / `removeAll` 兜底清理残留 `[data-sai]`
- **content: entry**: Content 入口与 SPA 守卫 (`src/content/main.ts`) — `hover` + `shortcut` 初始化、`history.pushState` / `hashchange` 清理
- **translate: shortcut**: 快捷键队列与多块容器拆分 (`src/content/shortcut.ts`) — 双轨 `chrome.commands` + `content keydown`、`getBlocksInRange` 容器→队列逐个翻译、限并发队列、`target_language` 显式透传
- **translate: background**: Service Worker 桥接 (`src/background/index.ts`) — `SAI_TRANSLATE` 模型解析 + `hy2-mt` `buildChatBody`、超时/并发控制、`SAI_CLOSE_ALL` 定点与广播 (`tabs.query` 全量广播)
- **translate: shared**: 复用翻译抽象 (`src/shared/translate.ts`) — `callLLM` / `extractContent` / `hyTarget` 去重，`popup` 与 `background` 共用
- **popup: settings**: 快捷键/Hover 配置页 (`src/popup/pages/ShortcutHoverSettings.tsx` + `src/popup/store/hoverConfig.ts`) — 快捷键自定义、行下/悬停开关、样式持久化
- **popup: close-all**: 一键关闭全部译文 (`src/popup/App.tsx` Sider 全局底部按钮 + `src/popup/pages/ModelTranslate.tsx` 页面卡片) — `runtime.sendMessage({type:'SAI_CLOSE_ALL'})` 广播优先 + `tabs.sendMessage` 直连回退
- **manifest**: 新增 `background.service_worker`、`content_scripts` (`<all_urls>`)、`commands` (`translate-selection` / `toggle-inline`)、`permissions` (`activeTab` + `tabs`)

### Changed
- `.gitignore`: 新增 `.omc` 忽略

## [1.0.0] - 2026-09-02

### Added
- 初始提交：Solid 1.9 + Vite 8 + CRXJS 2.4 的 MV3 弹窗翻译模板
- `ModelTranslate`: `hy2-mt` 显式 `target_language/language/target_lang` + `model:Suffix` 兼容
- Naive UI 风格弹窗布局、模型管理、`draft` 持久化
- CRXJS 与快捷行下嵌入方案调研/设计文档 (`docs/`)
