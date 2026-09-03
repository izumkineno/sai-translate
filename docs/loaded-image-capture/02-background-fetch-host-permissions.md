# 02 — background fetch（SW 重取，主力跨域路）

适用：跨域/大图/强制 `base64`。对应 `selection.ts#733 fetchImageViaBackground` + `background/index.ts` Vision 分支（`imageUrl` 直传服务端，见 `OPENAI_COMPAT_API.md §3.1`）。

## 为什么 SW 能绕过页面 CORS

- `content script` 的 `fetch` 受页面源 + CSP 限制；`service worker` 的 `fetch` 受扩展源约束，只要 `manifest` 有对目标的 `host_permissions`（本仓库 `<all_urls>`，`manifest.config.ts#24-25`）即免页面侧 CORS 预检。
- 仍受服务端热链/鉴权约束：`Referer/Cookie/Authorization` 该带还得带，`pixiv` 类需透传，否则 403/401。
- 同 URL 重取常命中 `HTTP cache`（`memory/disk`），不是每次都走真实网络；`no-store/签名过期` 则真发请求，可能失败，这时转 `03`。

## 标准写法（补齐 `SAI_FETCH_IMAGE` 缺口用）

```ts
// background/index.ts 草案：与现有 SAI_TRANSLATE 监听并列
chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if ((m as any)?.type !== 'SAI_FETCH_IMAGE') return;
  const url = String((m as any).url || '');
  if (!/^https?:\/\//i.test(url)) { sendResponse({ ok: false }); return true; }
  void (async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 40_000);
      const res = await fetch(url, {
        signal: ctl.signal,
        credentials: 'include',              // 带 Cookie 过鉴权墙
        // referrer: sender.tab?.url,        // 热链墙按需透传（webRequest extraHeaders 另议）
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (!/^image\//i.test(ct) && ct) throw new Error(`bad content-type ${ct}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 10 * 1024 * 1024) throw new Error('image too large');
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const mime = (/^image\//i.test(ct) ? ct.split(';')[0] : 'image/jpeg');
      sendResponse({ ok: true, dataUrl: `data:${mime};base64,${btoa(binary)}` });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
  })();
  return true; // 异步 sendResponse 必须返回 true
});
```

要点：`return true` 保活消息通道；`arrayBuffer→btoa` 分片防栈爆；`10MiB` 与 `selection.ts#921` 对齐；`content-type` 非 `image/` 直接拒，避免把 HTML 错误页当图送 Vision。

## content 侧（现状已写好，待 SW 补齐即通）

- `fetchImageViaBackground(src)` 要求回包 `data:image/` 前缀才认（`#735-736`），超时靠 SW 侧 40s + `getImageDataURLForTranslation` 的 3s load 等待分开算。
- `getImagePayloadForTranslation(mode='base64')`：`canvasEncode → fetchImageViaBackground → 回退 URL`（`#664-689`），保证“强制 base64 失败仍可译”。
- `mode='url'` 不进此通道，直接回 `rawSrc` 交服务端 `reqwest` 拉（省一次扩展流量，费服务端流量）。

## 边界

| src | 行为 |
|---|---|
| `data:` | 不走 fetch，直接用 |
| `blob:` | SW 够不着（blob URL 作用域在页），只能 canvas，见 `01` |
| `http(s)` + `host_permissions` 齐 | 成功，HTTP cache 常命中 |
| 签名过期/`no-store`/热链 403 | 失败，`ok:false`，上层回退 URL 或转 `03` 截图 |
| 超大（>10MiB） | 主动拒，上层按 `auto` 应直接选 URL 而非硬转 base64 |
