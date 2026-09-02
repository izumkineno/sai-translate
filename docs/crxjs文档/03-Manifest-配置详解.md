# 03 — Manifest 配置详解

> 来源：`packages/vite-plugin-docs/docs/concepts/00-manifest.md`、`src/node/defineManifest.ts`（完整类型）、`src/node/manifest.ts`（ManifestV3 接口）、`src/node/plugin-manifest.ts`（transform/render 流程）
> 关键类型：`ManifestV3` / `ManifestV3Export` / `ManifestV3Define` / `defineManifest` / `defineDynamicResource`

## 1. 三种写法

| 写法 | 文件 | 特点 |
|---|---|---|
| JSON | `manifest.json` | 配合 `https://json.schemastore.org/chrome-manifest.json` 在 VS Code 中获补全（`00-manifest.md#JSON Schema`） |
| JS/TS 对象 | `manifest.config.ts` | 本模板采用，`import pkg from './package.json'` 动态取版本，`defineManifest` 包一层即有类型 |
| 函数式 | `defineManifest((env) => ({...}))` | 接收 `ConfigEnv { mode, command }`，可按 `env.mode === 'staging'` 切换 `name` / `version` |

函数式示例（`00-manifest.md` 官方）：

```ts
import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

const [major, minor, patch, label='0'] = pkg.version
  .replace(/[^\d.-]+/g, '').split(/[.-]/)

export default defineManifest(async (env) => ({
  manifest_version: 3,
  name: env.mode === 'staging' ? '[INTERNAL] CRXJS Power Tools' : 'CRXJS Power Tools',
  version: `${major}.${minor}.${patch}.${label}`, // Chrome 扩展版本仅数字点分，最多四段
  version_name: pkg.version, // semver 可放在 version_name
}))
```

## 2. 路径规则（易错）

- **相对 Vite root**（`vite.config.ts` 所在目录），非 manifest 文件所在目录（`00-manifest.md#Manifest Paths`）
- **禁止**前导 `./` 或 `/`：`options_page: "options.html"` ✅ / `"./options.html"` ❌ / `"/abs/path"` ❌
- 类型层强制：`ManifestFilePath<T>` 用模板字面量排除以 `.` 或 `/` 开头的字符串（`defineManifest.ts`）

本模板：

```ts
action.default_popup = 'src/popup/index.html'
side_panel.default_path = 'src/sidepanel/index.html'
content_scripts[0].js = ['src/content/main.ts']
icons[48] = 'public/logo.png'
```

## 3. 类型全览（ManifestV3）

`src/node/manifest.ts` 定义约 40 字段，最常用子集：

| 字段 | 说明 | 本模板 |
|---|---|---|
| `manifest_version: 3` | 必填，仅支持 3 | ✅ |
| `name / version / description / icons` | 商店展示 | `name=pkg.name` |
| `action.default_popup` | 工具栏弹窗 | `src/popup/index.html` |
| `side_panel.default_path` | 侧边栏（Chrome 114+） | `src/sidepanel/index.html` |
| `background.service_worker` | MV3 后台（module） | 未启用，启用时 `type: "module"` |
| `content_scripts[]` | `js/css/matches/run_at/world` | `js: ["src/content/main.ts"], matches: ["https://*/*"]` |
| `permissions / host_permissions / optional_*` | API 权限 | `sidePanel`, `contentSettings` |
| `web_accessible_resources` | 供宿主页面访问的资源 | 自动生成，`defineDynamicResource` 补充 |
| `options_page / options_ui / devtools_page / chrome_url_overrides` | 其余页面 | 按需 |
| `browser_specific_settings.gecko` | Firefox 适配 | `crx({ browser: "firefox" })` 时生效 |
| `data_collection_permissions` | Firefox 可选 | `optional` |

完整类型见 `docs/03` 配套附录或直接 `import type { ManifestV3 } from '@crxjs/vite-plugin'`.

## 4. `defineManifest` 与 `defineDynamicResource`

```ts
export const defineManifest = <T extends string>(m: ManifestV3Options<T>): ManifestV3Export => m
export type ManifestV3Export = ManifestV3 | Promise<ManifestV3> | ((env: ConfigEnv) => ManifestV3 | Promise<ManifestV3>)

export const defineDynamicResource = ({ matches, use_dynamic_url }: ...) => ({
  matches,
  resources: [DYNAMIC_RESOURCE], // 占位符 "<dynamic_resource>"，构建时展开
  use_dynamic_url,
})
```

动态资源用于 `chrome.scripting.registerContentScripts` / `chrome.scripting.executeScript` 场景，需配合 `contentScripts: { standaloneFiles }` 或 `.iife.ts` 命名。

## 5. 插件对 manifest 的两阶段变换

`src/node/plugin-manifest.ts`：

1. **`transformCrxManifest`**（`transform` 钩子，输入文件名）：各 `crx:*` 插件可改 manifest（如 `pluginBackground` 注入 loader、`pluginWebAccessibleResources` 补 WAR）
2. **`renderCrxManifest`**（`generateBundle` 前，输出文件名）：将 `js/css/html/icons` 等映射为 chunk/asset 的 `refId → fileName`，最终写入 `dist/manifest.json`

期间 `structuredClone` + 逐插件 `try/catch` 包裹，报错前缀 `[plugin.name]`。

## 6. 校验与常见错

- `manifest_version !== 3` → 启动即 `throw "CRXJS does not support Manifest vX"`
- `version` 含非数字字符 → 参照 `00-manifest.md#TypeScript` 示例清洗 `replace(/[^\d.-]+/g, '')`
- 路径前导 `./` → 类型层报错或构建后 404

---

> 下一篇：`04-扩展页面与静态资源.md` —— `01-pages.md` 的 HTML 额外入口与 `web_accessible_resources` 自动生成
