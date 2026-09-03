---
name: dsh-worktree-ui
description: Use when developing the dsh-git-worktree plugin's visual UI (worktree management panel in the DeepSeek Harness web GUI) — planning where the UI mounts, prototyping with dynamic Cordis plugins, moving the Client half into the npm package, building the client bundle, or publishing a version with UI. Load before writing any Client Slot code for this plugin.
---

# dsh-git-worktree 可视化 UI 开发

目标：给 `dsh-git-worktree` 插件加可视化 worktree 管理面板（列表 + 操作按钮），最终并入 npm 包发布。完整参考文档见仓库 `docs/UI-DEVELOPMENT.md`；本技能是可执行步骤。

## 架构一句话

DSH 插件 UI = 同一个 npm 包里的 **Client 半**（浏览器代码），与 Host 半通过 `harness.handle` / `host.call` 做 JSON RPC。挂载链路：`dsh.bundle.patch`（Host 半）+ `dsh.client` 字段 + `exports["./client"]`（Client 半）→ `dsh-client-modules` serve `/plugins/<id>/client.js` → 浏览器 `__ModuleLoader__.load({ id, factory })`。

参考实现：harness 仓库 `packages/client/ui-trajectory/`（注册 `conversation.view` tab 的完整例子）。

## 步骤 0：每次动笔前 inspect（新 harness 版本可能不同）

1. `cordis_inspect_list` 确认 Provider（Host/Client 的 Service、Event、Builtin、Slots、Theme）
2. 对目标 Slot 用 `cordis_inspect_query(client, Slots, listSubTree, {root})` 查**完整契约**：registration、standardProps、ownerProps、occupants、replaceRisk
3. Client 相关服务用 `cordis_inspect_query(client, Service, listService)` 确认；Builtin 用 `client Builtin.listBuiltins`（当前是 ctx/React/host/styles/console）

## 步骤 1：方案选型

| 位置 | Slot | 说明 |
| --- | --- | --- |
| 会话视图 tab（推荐） | `conversation.view` | list 槽，注册 `{id, order, label}`；现有 chat/trajectory |
| 会话头按钮 | `conversation.session.header.actions` | list 槽，加打开面板的按钮 |
| 全局浮层 | `shell.overlay` | list 槽，弹窗 |
| 设置页 | `settings.section` | list 槽，全局配置 |

worktree 数据在 Host 侧（文件/仓库），UI 一律 `host.call` 取数，不依赖会话快照。

## 步骤 2：动态插件快速原型（开发主力）

用 cordis 会话（`cordis_define` + `cordis_run`），不碰包，改完即生效：

Client 半（纯 JS，无 JSX/TS/import，React.createElement）：

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'worktree', order: 20, label: () => 'Worktree' },
      (props) => {
        const [rows, setRows] = React.useState(null)
        React.useEffect(() => {
          host.call('wt/list', { sessionId: props.sessionId }).then(setRows)
        }, [props.sessionId])
        if (rows === null) return React.createElement('div', null, 'loading…')
        return React.createElement('ul', null,
          rows.items.map((r) => React.createElement('li', { key: r.checkoutId },
            `${r.name} — ${r.status}`)))
      },
    ))
  },
}
```

Host 半：

```js
return {
  apply(ctx) {
    harness.handle('wt/list', async (args) => {
      // 只返回纯 JSON 叶子字段；live 对象过不了 host.call
      return { items: [{ checkoutId: 'x', name: 'n', status: 'ready' }] }
    })
  },
}
```

调试：Run card 状态、`cordis_inspect_self` 读 `client-render` 诊断、浏览器 console（包级）、Client 热更新依赖 `pnpm run dev:web`。

## 步骤 3：并入 npm 包

- 文件：`src/client/index.ts`（注册）+ `src/client/WorktreePanel.tsx`（组件，包内源码允许 TSX）+ `tsdown.config.ts`
- package.json：`dsh.client = { inject: [...], platform: "web" }`；`exports["./client"]` → `lib/client.js`；files 加 client 产物；peerDeps 加 `react` 与 client 类型包；devDeps 加 `tsdown`/`lightningcss`；`build` 变 `tsc && tsdown`
- `cordis.patch.yml` **不用改**（同一行同时挂两个半）
- Host 半 `apply` 里追加 `harness.handle('worktree/list'|'worktree/discard'|...)`，复用现有 module
- tsdown 配置要点：
  - `format: 'cjs'`、`platform: 'browser'`、`entryFileNames: 'client.js'`
  - `external`: 平台模块（`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`）——**不能打进 bundle**，否则会产生双实例 React/Cordis/store engine
  - banner/footer：`window.__ModuleLoader__.load({ id: "dsh-git-worktree", factory: (require) => { ... return module.exports; } });`
  - `define` 三个 NODE_ENV 键（zustand 等探 process.env/import.meta.env）
  - 其他 `@deepseek-ai/*` 一律**只 `import type`**（擦除），值导入会被纯度门禁拒
  - 简单样式用 `styles.insert(css)`，或 CSS Modules（需 lightningcss 插件）

## 步骤 4：发布

1. `check-publish.mjs` 追加断言：`dsh.client` 存在（platform==='web'，inject 是数组）；`exports["./client"]` 存在；files 含 `lib/client.js`
2. 按 `docs/RELEASE.md`：build → check:publish → test → bump → tag → publish
3. 发布后实测：scratch profile 安装 → boot → **浏览器开 GUI 确认 tab 出现且数据可加载**

## 坑清单

- bundle 格式不匹配 `__ModuleLoader__.load` → 浏览器静默无 UI
- `dsh.client.inject` 列出的包必须在 profile 里（模块表条目来源）
- Host↔Client 只传 JSON；React 元素/函数/live 对象直接报错
- 动态代码纯 JS vs 包内源码可 TSX，别混用约束
- react 双实例 → hooks 报错
- 不要直接操作 `document`（CSS 注入走插件机制或 styles.insert）
