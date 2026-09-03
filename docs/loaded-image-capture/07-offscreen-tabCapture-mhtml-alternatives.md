# 07 — 备选：Offscreen / tabCapture / MHTML（为何不作主路）

## Offscreen document（`chrome.offscreen`，Chrome 109+ MV3）

- SW 无 DOM 时，用隐藏文档拿 DOM/Blob/Clipboard 能力：`createDocument({url, reasons, justification})`，`reasons` 含 `BLOBS/DOM_SCRAPING/DOM_PARSER/CLIPBOARD/LOCAL_STORAGE` 等；扩展权限可延续，但仅 `runtime` API 可用，需消息中转；同时只能开一个。
- 对“已加载图”无加成：offscreen 里 `drawImage` 同样 taint，`fetch` 能力与 SW 同级（都是扩展源 + host 权限），多一跳消息无收益。
- 适合场景：`Clipboard` 读写图、`DOMParser` 解析、`Blob URL.createObjectURL` 中转。翻译主路不需要。

## tabCapture（`chrome.tabCapture`）

- 拿 tab 音视频 `MediaStream`：`capture({audio,video})` 或 `getMediaStreamId({consumerTabId,targetTabId}) + getUserMedia`；需用户手势（点 action 近似 activeTab 语义），取流后本 tab 本地音频会被劫持，需 `AudioContext` 回放。
- 对单张 `<img>` 是杀鸡用牛刀：要从视频轨抓帧 → `video.pause + drawImage + toDataURL`，分辨率、帧同步、性能全亏，不如 `03` 一张截图。
- 适合场景：整页滚动录屏、视频帧 OCR。单图翻译不用。

## pageCapture（`chrome.pageCapture.saveAsMHTML`）

- 把 tab 存成单文件 MHTML（页 + CSS + 图全包），需 `"pageCapture"` 权限；文件只能落盘、只能主 frame 加载。
- 要从 MHTML 抠单图字节，还得解析 `multipart/related`，比 `02` 重取贵一个数量级。
- 适合场景：离线存档整页送审。单图翻译不用。

## scripting 世界（`chrome.scripting`，附带说明）

- `scripting + host/activeTab` 可运行时注入，`world: 'MAIN' | 'ISOLATED'` 只决定 JS 隔离，不改变 taint/CORS（渲染进程安全策略）。
- 对“已加载图”的唯一用处：在 `MAIN` 世界读页面 JS 变量里的原图 URL（懒加载 `data-src`、签名参数），拿到 URL 后仍回 `02/03`。不要指望换 world 绕 taint。
