# 05 — webRequest（只能看，不能拿）

## 定论

`chrome.webRequest` 拿不到图片字节，只能做观测与头改写。不要再往这条路加投入。

## 能做什么（`chrome.webRequest` 文档）

- 前提：`manifest` `"webRequest" + host_permissions`（本仓库已有，`manifest.config.ts#24-25`），拦截子资源还需“请求 URL + 发起页”双授权。
- 事件看到：`onBeforeRequest/onBeforeSendHeaders/onHeadersReceived/onResponseStarted/onCompleted/onErrorOccurred`，过滤 `filter:{urls, types:['image']}` 可得 `url/requestId/tabId/fromCache/statusCode/responseHeaders`。
- 可改：请求头（`Referer/Cookie` 需 `extraHeaders`，`Chrome 72+`）、重定向/取消（`onBeforeRequest`）。可用于热链补 `Referer`，配合 `02` 提高 fetch 成功率。

## 不能做什么

- 无任何事件给出响应体；`getResponseBody` 是 CDP 的，不是 webRequest 的。
- `MV3` 非策略安装扩展无 `webRequestBlocking`，改写能力进一步受限，大改头请走 `declarativeNetRequest`（同样无 body）。
- 同步 `XMLHttpRequest`、部分浏览器核心请求对扩展不可见；`file:/ws:/chrome-extension:` 等 scheme 事件集不全。

## 在本仓库的正确位置

- 可选增强：`onBeforeSendHeaders` 给 `i.pximg.net` 等补 `Referer: https://www.pixiv.net/`，`onHeadersReceived` 观察 `cache-control/content-length` 做大图预判。
- 不做：用它“缓存已加载图” — 做不到；“读 body 送 Vision” — 做不到，真要读体走 `02/03/04`。
