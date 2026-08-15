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

ToolView 的 logged args/result 仍可用于首屏摘要，但实时 mutation、diff 和 stale 检查必须调用 adapter。不要只凭历史 tool block 执行 Finalize。

## 文件所有权

建议新增：

```text
src/client/review-console/WorktreeReviewPanel.tsx
src/client/review-console/ReviewHeader.tsx
src/client/review-console/ChangedFiles.tsx
src/client/review-console/DiffViewer.tsx
src/client/review-console/ValidationEvidence.tsx
src/client/review-console/ReviewActions.tsx
src/client/review-console/useReviewDiff.ts
src/client/review-console/review-console.module.css
tests/client-review-console.test.tsx
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

## 只读 Diff 规则

使用 `adapter.reviewDiff()`：

- `modified/added/deleted/renamed/binary` 有明确标签；
- binary 显示“Binary file”，不渲染 patch；
- `truncated` 在总览和文件行均明确提示；
- patch 文本按纯文本渲染，不使用 `dangerouslySetInnerHTML`；
- 文件 path 不拼接为本地任意绝对路径；
- 第一版只读，不支持选择 hunk、编辑 patch、Preview 或 rollback；
- diff request 只在 panel 展开或用户选择文件后触发，避免 Ready card 首屏传大 payload。

可以先实现 unified diff；split view 和语法高亮不是验收要求。

## Validation 与详情

展示：

- summary；
- validation status/summary；
- tests：command、status、summary；
- changed files；
- suggested Commit Message；
- detailsMarkdown。

Markdown 若没有 Harness 官方安全 renderer 注入，则第一版使用 `<pre>` 纯文本，不能自行引入允许 raw HTML 的 renderer。

## 用户动作

### Finalize

- 主按钮默认 `cleanup`；
- secondary menu：retain 24h、retain 3d、retain manual；
- 显式点击才调用 adapter；
- submitting 时禁用全部 mutation；
- 成功使用响应的新 target/revision 更新 UI；
- stale 时显示“Review 已过期，请刷新”，不自动重试；
- Local conflict/recovery 显示对应 category/recovery action。

### Retention

- Ready 时通过 Finalize retention选择；
- 已 retained target 的后续 setRetention 由 Console 管理面板展示也可复用 ReviewActions；
- 不把 retained 当成未提交：必须同时显示 commitOid/cleanup 状态。

### Discard

- Ready target 的 Discard 必须二次确认；
- 文案说明“不会把 Worktree 修改提交到 Local”；
- dirty confirmation 在用户确认后才发送 `confirmDirty: true`；
- stale_target 时刷新，不自动重复 destructive action。

## 垂直 TDD 切片

### Slice 1：Review summary component

失败测试覆盖：summary、validation badge、changed files、Commit Message、tests。把现有 WorktreeReviewRow 的展示提取为 `WorktreeReviewPanel`，保持当前 ToolView 测试通过。

### Slice 2：Diff loading

失败测试覆盖：

- 未展开不请求 diff；
- 展开后请求精确 review identity；
- modified/added/deleted；
- binary patch null；
- file/total truncated；
- request failure 的 error meta/recovery。

再实现 unified diff viewer。

### Slice 3：Finalize

失败测试覆盖：

- exact checkout/revision/reviewId/retention；
- 不发送 commitMessage；
- double click 只调用一次；
- success 更新 target；
- stale 不自动 retry；
- transport failure 可手动 retry。

### Slice 4：Discard/Retention

先测 confirmation、cancel、不自动重放、retained response，再实现动作。

### Slice 5：ToolView integration

现有 logged Ready card 首屏仍能离线/replay 渲染；若实时 adapter 暂不可用，展示静态证据但禁用 mutation并提示“连接后刷新”。不能因为 Remote 未就绪让整张历史卡崩溃。

### Slice 6：Accessibility/large data

覆盖：键盘、focus、aria-live、200 files、长 path、长 patch、窄容器。不要用颜色作为唯一 diff 状态。

## 验收标准

- Review component 可被 ToolView 和 Console view复用；
- diff 严格绑定 review ID/revision；
- binary/truncated/stale 有清晰状态；
- Finalize request 不含任意 Commit Message；
- cleanup/retention 全部显式用户触发；
- Discard 二次确认；
- stale mutation 不自动重放；
- 现有 Ready ToolView replay 仍通过；
- 不实现 Preview/Rollback；
- 不修改 Harness。

## 验证命令

```bash
pnpm exec vitest run tests/console-contract.test.ts tests/client-review-console.test.tsx tests/client-toolview.test.tsx tests/client-bundle.test.ts
pnpm run typecheck
pnpm run build
pnpm run check:publish
```

Backend 合并后补真实 Review Remote + 浏览器 E2E：Ready → diff → stale negative → finalize/retention。

## 非目标

- Host Git diff 实现；
- Target Header/Drawer；
- raw Markdown HTML；
- hunk acceptance；
- Local Preview/Rollback；
- 自动 commit；
- 修改模型工具。

## Ready for Review 要求

报告必须列出：Review identity request、diff truncation/binary 行为、Finalize payload、stale 负向测试、ToolView replay、可访问性和仍待 Backend/Target UI integration 的点。不要自行 Apply、push、tag 或 publish。
