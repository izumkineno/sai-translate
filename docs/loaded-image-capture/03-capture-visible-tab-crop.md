# 03 — captureVisibleTab 裁剪（所见即所得兜底）

适用：`02` 失败时（热链 403、签名过期、`no-store`、canvas 污点）且图片在视口内。读的是“已渲染像素”，无视 CORS/taint/原 URL 是否还有效。

## 权限与限流（`chrome.tabs`）

- `tabs.captureVisibleTab()` 需对该 tab 有 host 权限或 `activeTab` 临时授权（用户手势触发即满足，本仓库 `activeTab + tabs + <all_urls>` 已齐）。
- `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` 限流，队列翻译时必须串行 + 节流，不可每图一次全速调。
- 截的是整视口 `png dataURL`，再在 content 侧按 rect 裁剪；`CDP Page.captureScreenshot(clip)` 可一步到位（见 `04`），但要 debugger 会话。

## 标准流程

```ts
// content：取 rect（含 DPR），滚入视口再截
img.scrollIntoView({ block: 'nearest' });
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const r = img.getBoundingClientRect();
const shot: string = await chrome.runtime.sendMessage({
  type: 'SAI_CAPTURE', rect: { x: r.x, y: r.y, w: r.width, h: r.height }, dpr: devicePixelRatio,
});
// background SW：
const full = await chrome.tabs.captureVisibleTab({ format: 'png' }); // 或 jpeg+quality 省体积
sendResponse({ ok: true, dataUrl: full });
// content：裁剪
const im = await createImageBitmap(await (await fetch(full)).blob());
const c = document.createElement('canvas');
c.width = Math.max(1, Math.round(rect.w * dpr));
c.height = Math.max(1, Math.round(rect.h * dpr));
c.getContext('2d')!.drawImage(im,
  rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr, 0, 0, c.width, c.height);
const out = c.toDataURL('image/jpeg', 0.85); // 同源 canvas，不脏
```

- 两次 `rAF` 等滚动稳定；`position:fixed` 遮挡/懒加载占位要在截前判 `rect.w*h>0` 且与视口相交。
- 精度是 CSS 渲染分辨率 × DPR，不是原图；`img.naturalWidth >> clientWidth` 的缩略图场景，OCR 小字会糊，`02` 能通优先 `02`。
- `jpeg 0.85` 体积远小于截图原生 png，Vision 够用且省 token。

## 何时用、何时不用

| 场景 | 结论 |
|---|---|
| 视口内 + 跨域污点/403/过期签名 | 用，这是唯一不碰原 URL 的路 |
| 视口外长列表批量图 | 先 `scrollIntoView` 逐张截，慢；或改送 URL 让服务端拉 |
| 原图分辨率敏感（小字 OCR） | 优先 `02` 取原字节，截图只作降级 |
| `blob:/data:` 已在页 | 同页 canvas 更快，不必截图 |
| 需要后台静默批量 | 截图会闪视口/滚屏，打扰用户，限并发 1 + 用户确认 |

## 与现有代码的接点（未实现，草案）

- 在 `shortcut.ts#getPayloadForImage` 的 `auto` 尾部、`translateImagesQueue` 的 `catch` 里加 `SAI_CAPTURE` 分支，`Vision` 失败且 `rect` 可见才调。
- `background` 新增 `SAI_CAPTURE` 监听（与 `02` 的 `SAI_FETCH_IMAGE` 并列），只做 `captureVisibleTab` 透传，不做裁剪（SW 无 DOM）。
