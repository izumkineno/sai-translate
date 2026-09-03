# 06 — 图标专用：`_favicon/` 服务

> 原问“图标方案”若指 favicon/tab 图标，看这篇；若指页面 `<img>`，回 `01-05`。

## 官方做法（扩展 How-To `favicons`）

不碰页面 DOM、不 fetch 原站，用 Chrome 内置图标服务：

```text
chrome-extension://<EXTENSION_ID>/_favicon/?pageUrl=<EXAMPLE_URL>&size=32
```

```ts
function faviconURL(u: string) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', u);
  url.searchParams.set('size', '32');
  return url.toString();
}
img.src = faviconURL('https://www.google.com');
```

## manifest

```json
{ "permissions": ["favicon"] }
```

- 若在 `content_scripts` 里用，还需：
```json
{ "web_accessible_resources": [{ "resources": ["_favicon/*"], "matches": ["<all_urls>"] }] }
```
- `"favicon"` 权限在已要 `tabs`/host 权限时不额外弹警告（本仓库已满足）。

## 备选：`tabs.Tab.favIconUrl`

- `chrome.tabs.query` 拿 `tab.favIconUrl`，需 `"tabs"` 或对该 tab 的 host 权限（本仓库 `tabs + <all_urls>` 已齐）。
- 拿到的是图标 URL，再走 `02` 的 SW fetch 转 `dataURL` 即可送 Vision；但多数站 favicon 本身跨域小图，直接送 URL 给服务端更省。
- 注意空/`chrome://` 页无 favicon，要判空回退默认图标。

## 与页面图片方案的关系

- favicon 不进 canvas 污点讨论，尺寸小（16/32），`Vision` 翻译场景极少需要 OCR 它；本篇仅为“图标”原问留档。
- 真要把 favicon 送翻译：优先 `_favicon/?size=32` 直链 → 服务端拉；要 base64 才走 `02`。
