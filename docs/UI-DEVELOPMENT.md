# dsh-git-worktree 可视化 UI 开发指导

给 dsh-git-worktree 加可视化 worktree 管理面板（列表 + 操作按钮）的完整路线：先在运行的 harness 里用动态插件快速迭代 UI，验证通过后再把 Client 代码并入 npm 包发布。本文所有 Slot/服务/机制均为对 DSH `0.1.0-rc.5` 线实测结果。

## 0. 架构总览

DSH 的插件 UI 是**同一个 npm 包里的 Client 半**（浏览器代码），与现有 Host 半（tools/commands/module）通过 Package-private JSON RPC 通信：

```
┌─ npm 包 dsh-git-worktree ─────────────────────────────┐
│ Host 半（Node，已有）          Client 半（浏览器，新增）  │
│ · apply(): 注册工具/命令        · apply(): 注册 Slot UI   │
│ · harness.handle('wt/list',    · host.call('wt/list')    │
│     fn)  ←JSON RPC── 仅 JSON──  ← 取数据                  │
└───────────────────────────────────────────────────────┘
```

挂载链路（已实测确认）：
1. 包的 `dsh.bundle.patch`（已有）→ 插件行进组合树，Host 半挂载
2. 包的 `dsh.client` 字段 → `dsh-client-modules`（node 半）扫描 Loader 条目时发现它，读 `exports["./client"]` 拿到浏览器 bundle，serve 为 `/plugins/<id>/client.js`
3. 浏览器端 `__ModuleLoader__` 加载该 bundle，Client 半注册进 Slot

参考实现（照抄它的结构）：`@deepseek-ai/dsh-client-ui-trajectory`（注册 `conversation.view` 视图 tab）——harness 仓库 `packages/client/ui-trajectory/`。

## 1. 方案选型：UI 放哪

开发前用 `cordis_inspect_query(client, Slots, listSubTree)` 查当前 Slot 树，以下是实测结果：

| 位置 | Slot | kind | 风险 | 适用 |
| --- | --- | --- | --- | --- |
| **会话视图 tab** | `conversation.view` | list | none | **推荐**：worktree 列表/操作面板，随会话显示 |
| 会话头按钮 | `conversation.session.header.actions` | list | none | 打开面板的快捷入口 |
| 全局浮层 | `shell.overlay` | list | none | 弹窗/抽屉 |
| 设置页 | `settings.section` | list | none | 全局配置（如默认保留期） |

`conversation.view` 注册协议（实测）：`{ id: 唯一字符串, order: number, label: string|()=>string }`，现有 occupants：`chat`(0)、`trajectory`(10)。组件 props = standardProps + ownerProps + 你 `inject()` 返回的字段：

- standardProps：`sessionId`、`useSession`（ConversationSnapshot）、`useSessions`、`useWorkspaces`、`useProjection`、`useInput`、`inputActions`
- ownerProps：`inspect` / `onInspectDone`

**worktree 面板建议**：注册 `conversation.view` 的 `worktree` tab，数据全部走 `host.call`（worktree 是仓库/文件系统数据，在 Host 侧），不依赖会话快照。

## 2. 开发期：动态插件快速迭代（换 harness 后第一步）

在新 harness 里用 cordis 会话（`cordis` preset）开发，不要直接改包——动态插件无需打包/发布，改完即生效：

1. 每个会话先 `cordis_inspect_list` 确认 Provider；写代码前对目标 Slot 用 `cordis_inspect_query(client, Slots, listSubTree, {root})` 查**完整契约**（registration/standardProps/ownerProps/occupants）
2. `cordis_define` 定义 Package（host + client 两个半），`cordis_run` 运行
3. Client 代码是**纯 JS**，无 JSX/TS/import：用 `React.createElement`、`styles.insert(css)`、`host.call(method, args)`（Builtin 只有：ctx/React/host/styles/console）
4. Host 半用 `harness.handle('方法名', async (args) => json)` 暴露数据；返回值必须可 JSON 序列化，不要传 live 对象

Client 半骨架（conversation.view tab）：

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
          rows.map((r) => React.createElement('li', { key: r.checkoutId },
            `${r.name} — ${r.status}`)))
      },
    ))
  },
}
```

Host 半骨架：

```js
return {
  apply(ctx) {
    // 这里调用现有的 worktree module（listManagedWorktrees 等）
    harness.handle('wt/list', async (args) => {
      return { items: await module.listManagedWorktrees() }  // 只返回纯 JSON
    })
  },
}
```

**调试手段**：Run card 状态；`cordis_inspect_self` 读失败诊断（`client-render` 栈）；浏览器 console（包级 console.log）；Client 插件热更新依赖 `pnpm run dev:web` 在重建 client bundle。

**常见失败**（技能速查）：
- `cannot get property "x" without inject` → 用了 `ctx.x` 但没声明 `inject`，或没走 `ctx.get`
- 页面报错 → 查该 Run 的 `client-render` 诊断；修复后 `cordis_define` 追加新 Package 并 `cordis_run update`
- `host.call` 失败 → 方法名、参数 JSON、Host 半 handler 是否注册
- Slot 注册失败 → 先查目标 Slot 的契约再注册

## 3. 落地期：并入 npm 包

UI 交互稳定后，把 Client 代码搬进 `dsh-git-worktree` 包（改造当前 tsc 构建为 tsc + tsdown client bundle）。

### 3.1 文件结构

```
src/
  index.ts              # 现有 Host 插件入口（不动）
  client/
    index.ts            # Client 插件：注册 slot
    WorktreePanel.tsx   # 组件（TSX 允许——这是包内源码，非动态代码）
    views.module.css    # 可选：CSS Modules
tsdown.config.ts        # client bundle 配置（新增）
```

### 3.2 package.json 改动

```jsonc
{
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },        // 已有
    "client": {                                          // 新增
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-conversation"],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.6"     // 类型 + 运行时模块表条目
  },
  "devDependencies": {
    "tsdown": "^0.x", "lightningcss": "^1.x", "react": "^18.2.0",
    "@types/react": "~18.3.1"
  },
  "scripts": {
    "bundle:client": "tsdown --config tsdown.config.ts",
    "build": "tsc && pnpm run bundle:client",
    "prepare": "pnpm run build"
  }
}
```

要点：
- `dsh.client.inject` 是 **Client 依赖包列表**（模块表边的来源），`platform` 必须是 `"web"`
- `exports["./client"]` 的 default 指向 `lib/client.js`——`dsh-client-modules` 从这里解析 bundle
- `cordis.patch.yml` **不用改**：同一行 `name: dsh-git-worktree` 同时挂 Host 半与 Client 半

### 3.3 Client bundle 构建（tsdown.config.ts）

Client bundle 必须是**闭包工厂格式**（浏览器 `__ModuleLoader__` 协议），参考 harness 的 `packages/client/tsdown.client.ts`。独立包（不在 harness monorepo）的最小配置：

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'dsh-git-worktree/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  // 平台模块表条目：浏览器模块表已提供，不能打进 bundle
  external: [
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-runtime/client', // 模块表里的运行时
  ],
  // 其余依赖（组件库、工具）全部内联；不要 import 其他 @deepseek-ai 包的“值”
  noExternal: (id) => (external.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-git-worktree", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
  // CSS Modules：用 harness 的 dsh-css-modules-inline 插件思路
  // （lightningcss transform → <style data-plugin> 注入），或组件里改用 styles.insert
})
```

**组件导入纪律（避免纯度门禁问题）**：
- `react`：external，安全
- `@deepseek-ai/dsh-client-runtime/client` 等：**只用 `import type`**（类型擦除后不进 bundle）
- 其他 `@deepseek-ai/*` 值导入一律避免——数据走 slot props / host.call，跨插件协作走 cordis 服务
- 简单样式直接 `styles.insert(css)`（Client Builtin），省掉 CSS Modules 插件

### 3.4 Host 半：暴露 UI 数据方法

在 `src/index.ts` 的 `apply` 里追加：

```ts
// Client 半通过 host.call('worktree/list') 等取数；只返回纯 JSON 叶子字段
harness.handle('worktree/list', async () => {
  const rows = await module.listManagedWorktrees()
  return { items: rows.map((r) => ({ checkoutId: r.checkoutId, name: r.name, status: r.status })) }
})
harness.handle('worktree/discard', async (args: { checkoutId: string; confirmDirty?: boolean }) => {
  // 复用现有 module 的 manage/discard 路径
  return { ok: true }
})
```

（动态原型期用 `harness.handle` 的写法与此相同，落地期只是挪进包内并复用真实 module。）

### 3.5 类型引用

Client 组件的 props 类型：`ConvViewProps` 来自 `@deepseek-ai/dsh-client-ui-conversation/client`（仅类型导入）；标准 hooks 类型来自 `@deepseek-ai/dsh-client-runtime/client`。新 harness 里先用 `cordis_inspect_query` 确认这些类型包/服务的当前路径（版本线不同可能改名）。

## 4. 发布与门禁

1. 扩展 `scripts/check-publish.mjs`，新增断言：
   - `dsh.client` 存在且 `platform === 'web'`、`inject` 是字符串数组
   - `exports["./client"]` 存在且 default 路径存在
   - `files` 含 `lib/client.js`
2. 按 `docs/RELEASE.md` 全流程：build（现在含 client bundle）→ check:publish → test → bump → tag → publish
3. **发布后实测**：scratch profile 安装 → boot → 浏览器开 GUI 确认 Worktree tab 出现、数据能加载

## 5. 已知坑清单

- client bundle 格式必须匹配 `window.__ModuleLoader__.load({ id, factory })`——格式错则浏览器静默无 UI
- `dsh.client.inject` 声明的依赖包必须真在 profile 里（它们是模块表条目来源）
- Host/Client 之间只传 JSON：函数、live 对象、React 元素过不了 `host.call`
- 动态 Client 插件与打包 Client 插件的代码约束不同：动态代码是纯 JS（无 JSX），包内源码可以 TSX
- `react` 等平台模块不要打进 bundle（external），否则双实例 React 导致 hooks 报错
- CSS 注入用插件自带机制或 `styles.insert`，不要直接操作 `document`
