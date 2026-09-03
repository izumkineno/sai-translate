# 04 — debugger + CDP（读缓存原始字节）

适用：要“已加载资源的原始字节、不重发请求”，且能接受调试横幅。日常翻译默认不开，仅作专家/取证备用。

## 原理（`chrome.debugger` + CDP `Network` 域）

- `manifest` 加 `"debugger"`，`attach({tabId}, "1.3")` 后 `sendCommand("Network.enable")`。
- 页内每个请求有 `Network.requestId`（`requestWillBeSent/responseReceived/loadingFinished` 事件里拿），图片的 `resourceType=Image`。
- `Network.getResponseBody({requestId})` 直接读缓存/网络栈里的响应体，返回 `{body, base64Encoded}`；`requestServedFromCache` 可确认命中缓存。
- `Page.captureScreenshot({format:'jpeg', quality:85, clip:{x,y,width,height,scale}})` 是 `03` 的 CDP 版，一步截指定区域，省前端裁剪。

```ts
await chrome.debugger.attach({ tabId }, '1.3');
await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
// 从 onEvent 收集 requestWillBeSent：request.url === img.src && type === 'Image' -> requestId
chrome.debugger.onEvent.addListener((src, method, params) => { /* 存 url->requestId */ });
const { body, base64Encoded } = await chrome.debugger.sendCommand(
  { tabId }, 'Network.getResponseBody', { requestId }) as any;
const bytes = base64Encoded ? Uint8Array.from(atob(body), c => c.charCodeAt(0)) : new TextEncoder().encode(body);
// 用完即 detach
await chrome.debugger.detach({ tabId });
```

## 代价（为什么不作主路）

- attach 后标签页顶部出现“正在调试”横幅，用户可点取消；同时只能有一个调试者（DevTools 打开会冲突）。
- `"debugger"` 是强警告权限，`Web Store` 审核与用户信任成本高。
- `requestId` 只在 attach 后新事件里有，attach 前已加载完的图片拿不到 id，需 `Network.enable` 后等二次触发或重载 — 对“已经加载”反而要刷新，违背初衷。常驻 attach 又常驻横幅。
- `getResponseBody` 对 `data:/blob:` 无意义，对 `no-store` 也可能已不可取。

## 与其它方案对比

| 维度 | debugger/CDP | captureVisibleTab(03) | background fetch(02) |
|---|---|---|---|
| 是否重发请求 | 否（读栈内） | 否（读像素） | 是（走 cache） |
| 精度 | 原始字节 | 渲染像素 | 原始字节 |
| 需可见 | 否 | 是 | 否 |
| 用户打扰 | 大（横幅+强权限） | 小（滚屏） | 无 |
| 实现复杂度 | 高（会话/事件/attach 竞态） | 中 | 低 |

结论：`sai-translate` 不引入；`03` 覆盖“不重下”需求后，本方案仅留文档备查。
