# 快捷键翻译 + 行下嵌入 — 方案集

> 独立文件夹，按顺序阅读即可从调研到开工。

| 序号 | 文档 | 作用 |
|---|---|---|
| 01 | [01-主流方案调研.md](./01-主流方案调研.md) | 沉浸式/沙拉查词等如何做快捷键与行下嵌入，含代码片段与取舍 |
| 02 | [02-行下嵌入方案设计.md](./02-行下嵌入方案设计.md) | 针对 sai-translate（Solid + CRXJS + popup-only 现状）的完整设计：架构/交互/manifest/通信/样式隔离 |
| 03 | [03-落地实施清单.md](./03-落地实施清单.md) | 按序 checklist，可直接建分支开工，含测试矩阵与风险回退 |

**一句话方案**：`chrome.commands(Alt+Shift+T)` + `content keydown(Alt+Q)` 双轨触发 → `window.getSelection()+findBlockAnchor` 定位 → `background` 统一走 OpenAI 兼容接口 → `Shadow DOM` 在目标块 `after()` 插入译文卡，`MutationObserver` 防网页重绘丢失。
