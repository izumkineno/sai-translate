# 01 — canvas 直读与 CORS 污点

适用：同源小图快路。`src/content/utils/selection.ts#600 canvasEncodeForPayload`、`#829 getImageDataURLForTranslation` 即此路。

## 规则（MDN `CORS_enabled_image`）

- 画进 canvas 的任一像素来自“无 CORS 审批的跨域”，canvas 即 `tainted`。
- `tainted` 后 `getImageData / toDataURL / toBlob / captureStream` 全抛 `SecurityError`，防跨站私数据被读走。
- 解锁条件同时满足：服务端回 `Access-Control-Allow-Origin`（允许该源或 `*`）+ 图片以 `crossOrigin="anonymous"` 重新加载。`pixiv/i.pximg.net` 类热链/CDN 无此头，此路必败。

## 本仓库实现

```ts
// selection.ts#600 简化
const c = document.createElement('canvas');
c.width = w; c.height = h;
const ctx = c.getContext('2d')!;
if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h); } // jpeg 无透明，铺白防黑底
ctx.drawImage(img, 0, 0, w, h);          // 跨域无 ACAO 时这里不抛，脏标记延后
return canvas.toDataURL(mime, 0.92);     // 脏了在这里抛 -> catch 返回 null
```

- `MAX_SIDE=8192`、`MAX_PIXELS=33_000_000` 先缩放，`jpeg/webp quality 0.92`，`png` 保持（`#864-884`）。
- 超限压缩：`bytes>10MiB 或 b64>14M` 则 `*0.9` 最多 3 次，仍超返回 `null` 转 URL（`#921-938`）。
- `drawImage` 本身对污点不抛，`toDataURL` 才抛，所以必须 `try/catch` 包住编码段，不能只包绘制段。

## 能读什么、不能读什么

| src | 结果 |
|---|---|
| `data:image/` | 直接可用，不走 canvas（`#643`） |
| `blob:` | 仅 canvas 可转（同页已解码位图），服务端不支持 `blob:`，失败即 `null`（`#646`） |
| 同源 `http(s)` 小图 | 成功，主力快路 |
| 跨域无 ACAO（`i.pximg.net` 等） | `toDataURL` 抛，返回 `null`，必须转 `02/03` |
| `img.complete=false / naturalWidth=0` | 直接 `null`，`getImageDataURLForTranslation` 最多等 `load` 3s（`#831`） |

## 常见误区

- 给已加载 `<img>` 事后加 `crossOrigin` 不生效，必须新建 `Image()` 重载才会带 CORS 请求；且命中内存缓存时仍可能不发预检，结果不稳定。
- `createImageBitmap / OffscreenCanvas / SVG foreignObject` 同一套 taint 规则，换 API 绕不过。
- `MAIN` world 注入也绕不过，这是渲染进程安全策略，不是 JS 隔离问题。
