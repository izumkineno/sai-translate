# 已加载图片的插件读取方案（总览）

> 独立目录：`docs/loaded-image-capture/`，专门收录“浏览器已经加载好的 `<img>`，插件如何不二次踩坑地拿到可送 Vision 的字节”。
> `web_search` 在此环境被各家 bot 墙全挡（`google/duckduckgo/ecosia/mojeek/startpage` 均 `blocked/challenge`），本目录改用 `read` 直读官方文档 + 仓库现状实测整理而成。

## 结论（先看这段）

| 目标 | 可用方案 | 一句话 |
|---|---|---|
| 同源小图，最快 | `01` canvas 直读 | `drawImage + toDataURL`，零权限、零消息 |
| 跨域/大图，主力 | `02` background fetch | `SW` 带 `host_permissions` 重取，走 HTTP cache，常无真实网络 |
| 热链/签名过期/`blob:`/canvas 污点兜底 | `03` captureVisibleTab 裁剪 | 读“已渲染像素”，无视 CORS/taint，仅视口内 |
| 取缓存原始字节，不重下 | `04` debugger + CDP | `Network.getResponseBody`，有调试横幅，默认不开 |
| 只观测不拿体 | `05` webRequest | 能看到 `type=image` 请求，拿不到 body |
| 图标（favicon）专用 | `06` `_favicon/` 服务 | `chrome-extension://ID/_favicon/?pageUrl&size`，不碰页面 |
| 不推荐作主路 | `07` tabCapture/offscreen/MHTML | 流/离屏/DOM 解析成本高，只列边界 |

`sai-translate` 推荐链路（对应 `08`）：

```
canvasEncodeForPayload（同源小图）
  -> background fetch（跨域/大图，服务端 reqwest 拉 http(s) URL，见 OPENAI_COMPAT_API.md §3.1）
  -> captureVisibleTab 裁剪（可见区终极兜底，未实现，08 有接口草案）
```

## 现状缺口（实测，写文档时发现）

- `src/content/utils/selection.ts#733 fetchImageViaBackground` 发送 `{type:'SAI_FETCH_IMAGE'}`，但 `src/background/index.ts#140-416` 当前只处理 `SAI_CLOSE_ALL*` + `SAI_TRANSLATE`，**无 `SAI_FETCH_IMAGE` 监听**，跨域 canvas 污点分支实际走 `null`。
- `getImagePayloadForTranslation(mode)` 的 `base64` 强制分支同样依赖该通道，`url` 模式不受影响（直接走服务端拉取）。
- 本目录 `02` 给出补齐草案（`fetch→blob→FileReader→dataURL` + `Referer` 透传 + 超时），`08` 有验收标准。

## 目录

- `01-canvas-cors-taint.md` — canvas 污点规则与同源快路
- `02-background-fetch-host-permissions.md` — SW 重取、host 免 CORS、HTTP cache、缺口补齐
- `03-capture-visible-tab-crop.md` — 可见区截图 + DPR 裁剪，所见即所得
- `04-debugger-cdp-getResponseBody.md` — 读缓存字节，代价是调试横幅
- `05-webrequest-observe-only.md` — 为什么 webRequest 拿不到图
- `06-favicon-service.md` — 图标专用 `_favicon/`（呼应“图标方案”原问）
- `07-offscreen-tabCapture-mhtml-alternatives.md` — Offscreen/BLOBS、tabCapture 流、pageCapture MHTML
- `08-sai-translate-integration.md` — 本仓库映射、阈值、待办

## 决策树

```text
img.src 是 data:image/ ? ──是──> 直接送 Vision（无视 mode）
  否
  ├─ blob: ? ──> 只能 canvasEncode（同页已解码位图），失败即不可译
  └─ http(s) ?
       ├─ mode=url ──> 直接送 URL，服务端拉取
       ├─ mode=base64 ──> canvasEncode → SAI_FETCH_IMAGE → 回退 URL
       └─ mode=auto（默认）──> 跨域或大图(>1M像素或边>1600)送 URL；
                              小图同源试 canvasEncode（10MiB/14M 守卫），失败送 URL；
                              未来：URL 路径 Vision 失败再试 captureVisibleTab
```

阈值定义见 `src/content/utils/selection.ts#589 isLargeImage`、`#913 getBytes`。

## 来源（直读，非搜索）

- MDN `CORS_enabled_image`：tainted 后 `toDataURL/toBlob/getImageData/captureStream` 抛 `SecurityError`，需 `crossOrigin=anonymous + ACAO`
- `chrome.tabs`：`captureVisibleTab` 需 host/`activeTab`，`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` 限流
- `chrome.webRequest`：需 `webRequest + host_permissions`，只暴露请求元数据，无 body
- `chrome.debugger`：需 `debugger` 权限，开放 `Network` 等域，可 `sendCommand`
- CDP `Network` 域：`getResponseBody(requestId)` 取缓存体，`requestServedFromCache` 可判缓存命中
- `chrome.offscreen`：`reasons:['BLOBS'|'DOM_SCRAPING'|'CLIPBOARD'...]`，扩展权限可延续但仅 `runtime` API
- `chrome.tabCapture`：需用户手势（action 点击近似 activeTab），取 tab 音视频 `MediaStream`
- `chrome.pageCapture`：`saveAsMHTML` 打包页 + 资源单文件，仅文件系统加载、仅主 frame
- `chrome.scripting`：`scripting + host/activeTab` 运行时注入，可选 `MAIN/ISOLATED` world
- 扩展 favicon：`chrome-extension://ID/_favicon/?pageUrl&size`，manifest 需 `favicon` 权限，content 用需 `web_accessible_resources: _favicon/*`
