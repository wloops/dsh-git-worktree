# 并行交接 3：Review UI

## 任务目标

实现 Worktree Console 的 Review UI：显示持久化 review 元数据、只读文件 diff、验证证据、建议 Commit Message，并通过 `WorktreeConsoleAdapter` 执行精确 review-bound Finalize、Retention、Discard。保留并增强现有 Ready ToolView，同时把核心 Review component 做成可复用组件。

共享基线：

- [`../WORKTREE-CONSOLE-ARCHITECTURE.md`](../WORKTREE-CONSOLE-ARCHITECTURE.md)
- [`../../src/console-contract.ts`](../../src/console-contract.ts)
- [`../../tests/support/worktree-console.ts`](../../tests/support/worktree-console.ts)

开发期只依赖共享 fixture。不得直接读取 filesystem/Git，不得调用 raw connection、fetch、隐藏 command 或模型工具。

## 产品形态

第一版建议一个可复用 `WorktreeReviewPanel`，由两处承载：

1. 现有 `worktree_ready_for_review` ToolView：继续保持对话内、replay-stable 的交付记录；
2. Worktree Console view：选中 `ready_for_review` row 时显示同一 Review panel。

ToolView 的 logged args/result 仍可用于首屏摘要，但实时 mutation 和 stale 检查必须调用 adapter。普通验收卡不再请求 Diff；不要只凭历史 tool block 执行 Finalize。

## 文件所有权

当前实现：

```text
src/client/review-console/WorktreeReviewPanel.tsx
src/client/review-console/ReviewActions.tsx
src/client/review-console/status-events.ts
src/client/review-console/review-console.styles.ts
src/client/target-console/WorktreeReviewStatus.tsx
tests/client-review-console.test.tsx
tests/client-target-console.test.tsx
```

本 Track 可以修改：

```text
src/client/WorktreeReviewRow.tsx
src/client/model.ts
```

只做现有 ToolView 到共享 Review panel 的适配。保持 tool block parser replay-stable。

不得修改：

```text
src/console-contract.ts
tests/support/worktree-console.ts
src/console-host/**
src/client/console-remote/**
src/client/target-console/**
src/client/index.tsx 的 Target Slot wiring
package.json
tsdown.config.ts
```

如 standalone Console view 的最终 import 尚不存在，只导出可复用组件和 registrar，由 integration pass/Session UI Track 接线；不要抢改共享入口。

## Review 身份规则

每个实时 Review operation 必须携带：

```text
sessionId
checkoutId
expectedRevision
expectedReviewId
```

Finalize 额外携带 retention。UI 不允许编辑或提交任意 commitMessage；显示的建议 Commit Message 来自 persisted review，Host Finish 同样从 persisted review 读取。

发生以下任一情况时，当前 Review 必须作废并刷新：

- revision 改变；
- review ID 改变；
- Backend 返回 stale_target/stale_isolated/stale_local；
- reviewDiff 无法验证 fingerprint/head；
- target delivery 已回到 working。

UI 不得继续显示旧按钮为可用状态，也不得自动重放 Finalize。

## Review Diff 归属

`adapter.reviewDiff()` 的严格 review identity、truncation、binary 与纯文本安全规则继续保留在 Backend/高级 Worktree Console，但普通验收卡不再展示 `Show diff` 或加载 patch。验收主流程依赖 review ID、revision、fingerprint/head 和 Local CAS，不依赖用户先展开 Unified diff。

## Validation 与详情

普通验收卡按 Domi 信息层级只默认展示：

- iteration + summary；
- validation status；
- changed file 数量；
- 默认折叠的 validation summary/tests。

文件路径列表、suggested Commit Message、detailsMarkdown 和 Diff 不默认铺在卡片中。完整证据仍持久化于 review/tool record；Commit Message 只在提交确认 Modal 中展示和编辑。

## 用户动作

### Preview / Finalize

- Ready 状态条和验收卡只显示一个主按钮“同步到 Local 验收”与一个“更多”菜单；主按钮先执行只读 preflight，再调用 Preview，不打开提交 Modal；
- Preview active 后主按钮变为“验收通过并提交”，更多菜单提供“撤回本次预览”；Ready 更多菜单提供“跳过验收，直接提交”；
- 两条提交路径都使用官方 Modal 确认/编辑 1–500 字符 Commit Message，默认 cleanup；只有勾选“提交后暂时保留当前运行环境”后才显示 retain 24h / 3d / manual select；
- submitting 时禁用全部 mutation；成功必须使用 Host 响应的新 target/revision 更新 UI，历史 ToolView 也要跟随同一 review 的最新 revision；
- stale/Local drift 不自动重试。Host 返回 detached/recovery 时保留 Worktree 与恢复证据，并显示重新尝试撤回入口；
- `Inspect`、Diff、setRetention 与高级 cleanup 诊断留在 Worktree Console。

### Retention

- Ready 时通过 Finalize retention选择；
- 已 retained target 的后续 setRetention 由 Console 管理面板展示也可复用 ReviewActions；
- 不把 retained 当成未提交：必须同时显示 commitOid/cleanup 状态。

### Discard

- Ready/Preview target 的 Discard 必须二次确认；
- active Preview 的文案必须说明“先安全撤回，只有撤回成功才删除 Worktree”，请求携带 `rollbackPreview: true`；
- dirty confirmation 在用户确认后才发送 `confirmDirty: true`；
- stale_target 时刷新，不自动重复 destructive action。

## 垂直 TDD 切片

### Slice 1：Review summary component

失败测试覆盖：summary、validation badge、changed files、Commit Message、tests。把现有 WorktreeReviewRow 的展示提取为 `WorktreeReviewPanel`，保持当前 ToolView 测试通过。

### Slice 2：Preview lifecycle

失败测试覆盖：read-only preflight、Preview success/conflict、最新 revision、Preview→rollback、Preview→finalize、Local drift detached 与恢复入口。普通验收卡不请求或展示 Diff。

### Slice 3：Finalize

失败测试覆盖：exact checkout/revision/reviewId/Commit Message/retention、direct finish 与 finalizePreview 分流、double click 只调用一次、success 更新 target、stale 不自动 retry、transport failure 可手动 retry。

### Slice 4：Preview-aware Discard/Retention

先测 confirmation、cancel、不自动重放、retained response，再实现动作。

### Slice 5：ToolView integration

现有 logged Ready card 首屏仍能离线/replay 渲染；若实时 adapter 暂不可用，展示静态证据但禁用 mutation并提示“连接后刷新”。不能因为 Remote 未就绪让整张历史卡崩溃。

### Slice 6：Accessibility/large data

覆盖：键盘、focus、aria-live、200 files、长 path、长 patch、窄容器。不要用颜色作为唯一 diff 状态。

## 验收标准

- Review component 可被 ToolView 和 Console view复用；
- preflight/Preview/rollback/finalize 严格绑定 review ID/revision 与 Host 能力；
- 普通验收卡不展示 Diff/Inspect；
- Finalize request 只包含用户在官方 Modal 中确认的受限 Commit Message；
- cleanup/retention 全部显式用户触发；
- Discard 二次确认；
- stale mutation 不自动重放；
- 现有 Ready ToolView replay 仍通过；
- Preview active 的 Discard 先 rollback；detached/recovery 保留入口；
- 不修改 Harness。

## 验证命令

```bash
pnpm exec vitest run tests/console-contract.test.ts tests/client-review-console.test.tsx tests/client-toolview.test.tsx tests/client-bundle.test.ts
pnpm run typecheck
pnpm run build
pnpm run check:publish
```

Backend 合并后补真实 Remote + 浏览器 E2E：Ready → Preview → rollback，以及 Ready → Preview → finalize/retention；另测 direct finish、slot contention 和 Local drift。

## 非目标

- Host Git diff 实现；
- Target Header/Drawer；
- raw Markdown HTML；
- hunk acceptance；
- 浏览器提供 patch/receipt/Local 路径；
- 模型自动触发 Preview/commit；
- 修改模型工具。

## Ready for Review 要求

报告必须列出：Review identity request、diff truncation/binary 行为、Finalize payload、stale 负向测试、ToolView replay、可访问性和仍待 Backend/Target UI integration 的点。不要自行 Apply、push、tag 或 publish。
