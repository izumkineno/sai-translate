# 08 — sai-translate 落地映射
> 落地状态（2026-09-03）：P0/P1 已实现 — `background` 补齐 `SAI_FETCH_IMAGE（force-cache+referrer,15s/10MiB）` 与 `SAI_CAPTURE（jpeg90 透传）`；`selection` 新增内存 LRU（30 条/30MB/5min TTL）+ `captureScreenshotPayload` 帧缓冲裁剪；`auto` 小图跨域不再直返 URL，大图仍直返保分辨率。详见本文件待办勾选。

## 现有链路（`mode` 可配，默认 `auto`）

`popup/store/hoverConfig.ts`：`ImagePayloadMode='auto'|'url'|'base64'`，key `sai_translate_image_mode`，默认 `auto`。

`content/utils/selection.ts`：

| 函数 | 行 | 职责 |
|---|---|---|
| `isCrossOriginUrl` | `#580` | `new URL(src, location.href).origin !== location.origin` |
| `isLargeImage` | `#589` | `>1M像素 或 边>1600` 即大图 |
| `canvasEncodeForPayload` | `#600` | 纯 canvas 编码，无后台兜底，供上层决策 |
| `getImagePayloadForTranslation(img, mode)` | `#636` | `data:`直返；`blob:`仅 canvas；`http(s)` 按 mode 分流；`auto`=跨域/大图→URL，小图同源→base64（10MiB/14M 守卫），失败回 URL |
| `isTranslatableImage` | `#710` | `data:/blob:/http(s)` 放行，`complete/naturalWidth` 门控 |
| `fetchImageViaBackground` | `#733` | 发 `SAI_FETCH_IMAGE`，认 `data:image/` 回包 |
| `getImageDataURLForTranslation` | `#829` | 旧单图 canvas 路，等 load 3s，污点转后台 fetch |

`content/shortcut.ts`：`resolveImageHelpers + getPayloadForImage(+imageMode) → doTranslateImage(imageUrl)`，`TranslateReq{kind:'image', text:imageUrl, imageUrl}`（`#15/#331`）；`background/index.ts#255` 校验 `data:* 或 http(s)` 后调 `callVisionLLM`（40s 超时）。

## 待办（按序）

1. **补 `SAI_FETCH_IMAGE`（P0）**：`background` 加 `02` 草案监听，与 `SAI_TRANSLATE` 并列；验收：跨域小图 `mode=base64` 不再直接 `null`，`chrome.runtime.sendMessage({type:'SAI_FETCH_IMAGE',url})` 回 `data:image/`。
2. **加 `SAI_CAPTURE` 兜底（P1）**：`background` 透传 `captureVisibleTab`，`content` 做 `scrollIntoView + rAF + DPR 裁剪`（`03` 草案）；验收：403/签名过期图在视口内仍可译；队列限并发 1。
3. **可选热链补头（P2）**：`webRequest.onBeforeSendHeaders + extraHeaders` 给目标域补 `Referer`（`05`），先只做 `02` 失败率统计再决定。
4. **不做**：`debugger/CDP` 常驻、`tabCapture/offscreen/MHTML` 主路、`_favicon/` 混入图片链（图标独立）。

## 调试命令

```js
// 看当前模式
chrome.storage.local.get('sai_translate_image_mode')
// 看 payload 决策（content console）
const img = document.querySelector('img');
await getImagePayloadForTranslation(img, 'auto')
// 看后台通道（补齐后）
await chrome.runtime.sendMessage({ type: 'SAI_FETCH_IMAGE', url: img.src })
```
