# 并行交接 2：Session Target UI

## 任务目标

实现 Harness-native、可发现的 Session Target UI：Header 状态胶囊 + Worktree Console view，支持查看当前 target、项目列表、Create/Open 和安全 Discard。它不依赖模型主动调用 `worktree_create`，但保留现有对话 ToolView。

共享基线：

- [`../WORKTREE-CONSOLE-ARCHITECTURE.md`](../WORKTREE-CONSOLE-ARCHITECTURE.md)
- [`../../src/console-contract.ts`](../../src/console-contract.ts)
- [`../../tests/support/worktree-console.ts`](../../tests/support/worktree-console.ts)

本 Track 使用 `WorktreeConsoleAdapter`，开发时用共享 fixture；Backend 合并后替换为真实 Remote adapter。不得直接调用 raw connection、fetch、隐藏 prompt 或模型工具。

## Harness UI 方案

使用已经核验的公开 Slot：

1. `conversation.session.header.actions`
   - 注册 `id: worktree-target`；
   - 显示 Local、Creating、Working、Ready、Retained、Cleanup、Recovery；
   - 状态必须来自 `adapter.current({ sessionId })`，不按 cwd 字符串自行猜测。

2. `conversation.view`
   - Harness seam 已验证，但当前产品暂不注册 `id: worktree` 页签；
   - `WorktreeConsoleView` 保留为未挂载的管理/恢复组件，主流程稳定后再评估入口；
   - 展示当前项目 target 和 project-scoped Worktree list；
   - Header action 点击后应切换到该 view。若 Harness 当前 header owner props 无直接切 tab API，先把 action做成可访问状态入口并在组件内使用正式 conversation action；不得 DOM 查询/模拟点击。

3. `shell.overlay`
   - 非必需；只有确认官方 props 能支持状态管理且不会挡住 app 后才使用；
   - 第一版优先 conversation view，避免额外 root-level store。

4. `tool.call.toolview`
   - 保留现有 Create/Ready ToolView；
   - 现有 `openIsolatedTarget()` 行为应与 Console Open 共用一个 helper。

## 文件所有权

建议新增：

```text
src/client/target-console/index.ts
src/client/target-console/TargetStatusAction.tsx
src/client/target-console/WorktreeConsoleView.tsx
src/client/target-console/TargetSummary.tsx
src/client/target-console/WorktreeList.tsx
src/client/target-console/useWorktreeConsole.ts
src/client/target-console/target-console.module.css
tests/client-target-console.test.tsx
```

本 Track 可以修改：

```text
src/client/index.tsx
src/client/actions.ts
```

但只做 Slot 注册、Adapter 注入和 Create/Open helper 复用。不要重写 Client ModuleLoader wrapper。

不得修改：

```text
src/console-contract.ts
tests/support/worktree-console.ts
src/console-host/**
src/client/console-remote/**
src/client/review-console/**
src/client/WorktreeReviewRow.tsx
package.json 的 Remote/Typert 区域
tsdown.config.ts 的 Remote/Typert 区域
```

如果真实 Remote 尚未合并，导出 `registerTargetConsole(ctx, adapter)` 或等价 registrar，让 integration pass 接线；不要复制 fake 到生产代码。

## 状态与交互

### Header 状态

| state | 标签 | 强调 |
| --- | --- | --- |
| local | `Local` | 中性，可创建 |
| creating | `Creating…` | loading，禁止重复创建 |
| working | `Worktree` | 正常强调 |
| ready_for_review | `Ready` | 高可见但非错误 |
| retained | `Retained` | 显示到期时间 |
| cleanup_pending | `Cleanup` | warning，可 retry |
| recovery_required | `Recovery` | error，不展示普通 mutation |
| delivered | `Delivered` | 弱化历史状态 |

状态和 capabilities 分离：即使 state 相同，也只渲染服务端返回 `capabilities.* === true` 的 action。

### Create

- 只从 Local/source Session 显示；
- 调用 `adapter.create({ sourceSessionId: sessionId })`；
- 成功后调用共享 Open helper：

```text
workspaces.create(managedRoot)
sessions.create(exact targetSessionId)
sessions.open(targetSessionId)
```

- 返回 Session ID 与预分配 ID 不一致时 fail closed；
- 不修改 source Session cwd；
- Creating 期间防重复点击。

### Open

- 只使用 identity-validated detail 中的 `managedRoot`；
- list summary 没有 path，点击 list row 应先 `inspect()`；
- Workspace/Session create 要保持幂等；
- 错误展示稳定 code/category，不展示虚假成功状态。

### List/refresh

- `adapter.list({ sessionId })` 只显示当前项目；
- 提供显式 Refresh；
- action 成功后以服务端新 summary 更新，然后后台 refresh；
- 不乐观增加 revision；
- component unmount 后忽略晚到 response。

### Discard

- 仅 capabilities.discard；
- dirty target 必须显示二次确认；
- request 携带当前 checkoutId + expectedRevision + confirmDirty；
- stale_target 时刷新，不自动重放 destructive action；
- source Session 删除未打开 reservation 和 owner target discard 的文案要区分。

### Recovery/Cleanup

- recovery_required 只展示诊断与恢复入口，不显示 Create/Finalize；
- cleanup_pending 可调用 `retryCleanup`；
- retained 可展示 retention 与 expiresAt；setRetention 是否放在本 Track 可按版面决定，但必须走 adapter。

## 垂直 TDD 切片

### Slice 1：Header registration + Local state

失败测试：

- 注册 `conversation.session.header.actions` 精确 id；
- Local 标签可见；
- unmount/dispose 后 Slot entry 消失；
- adapter.current 被传入 props.sessionId。

实现最小状态 action。

### Slice 2：Console view + list

失败测试：

- 断言当前不注册 `conversation.view`，同时保留 Header 状态胶囊和验收 dock；
- `WorktreeConsoleView` 独立组件继续覆盖 loading/empty/error/list 四种状态；
- 不显示 managedRoot（summary 无该字段）；
- Ready/Recovery 行可识别。

### Slice 3：Create/Open

使用共享 fixture 扩展/测试 double：

- Create 只调用一次；
- exact targetSessionId 创建并打开；
- unexpected Session ID 报错；
- source Session 不被 sessions.open；
- create failure 不留下“Working”假状态。

### Slice 4：Inspect/Open list row

先 inspect 再 open；permission/stale/missing path 分别展示明确恢复动作。

### Slice 5：Discard/Cleanup

先测 dirty confirmation、revision request、stale 不自动重试、retryCleanup 成功刷新，再实现按钮。

### Slice 6：真实 Slot/runtime integration

在 Harness 当前 Slot 类型面上验证：

- Header action props；
- 未来重新启用 conversation view 时的公开切换方式；
- HMR/disposal；
- Client bundle 不内联第二份 React；
- existing ToolViews 仍注册。

## UX/Accessibility 验收

- 每个 icon-only action 有 accessible name；
- loading 使用 `aria-live`，不抢焦点；
- confirmation 可键盘完成/取消；
- 错误消息包含稳定用户动作，不只显示 code；
- 颜色不是唯一状态信号；
- 窄宽度下列表不横向撑破 conversation view；
- 不出现来源实现的产品文案或产品归因。

## 验收标准

- 普通 Harness 启动后无需工具调用即可看到 Session Target 状态入口；
- Local 用户可以直接创建并打开隔离 Session；
- 当前项目 Worktree 可列出、inspect、open；
- destructive action 有用户确认和 revision CAS；
- Recovery/Ready/Retained 状态可发现；
- 现有 Create/Review ToolView 继续可用；
- 不调用模型、不发送隐藏 prompt；
- 不修改 Harness。

## 验证命令

```bash
pnpm exec vitest run tests/console-contract.test.ts tests/client-target-console.test.tsx tests/client-toolview.test.tsx tests/client-bundle.test.ts
pnpm run typecheck
pnpm run build
pnpm run check:publish
```

真实 Remote 合并后再运行本地 tarball + Playwright E2E；本并行分支可先使用 fixture 完成组件验收。

## 非目标

- Host Remote 实现；
- Review diff 内容；
- 浏览器自行生成 Preview receipt 或修改 Local；
- 全局跨项目 Manager；
- 模型自动触发 Finalize；
- workflow/subagent isolation。

## Ready for Review 要求

报告必须列出：实际使用的 Slot、状态/能力矩阵、Create/Open 精确 ID 证据、dirty confirmation、stale 行为、组件测试和仍待 Backend integration 的点。不要自行 Apply、push、tag 或 publish。
