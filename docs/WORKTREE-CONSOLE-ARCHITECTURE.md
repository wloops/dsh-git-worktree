# Harness-native Worktree Console：并行开发共享架构

## 1. 本轮边界

本文是 Backend Control Plane、Session Target UI、Review UI 三条并行 Worktree 的共同基线。共享 JSON 契约位于 [`src/console-contract.ts`](../src/console-contract.ts)，测试 fixture 位于 [`tests/support/worktree-console.ts`](../tests/support/worktree-console.ts)。

本文现已升级为 Worktree Console 与两阶段验收生命周期的共同基线。它不实现跨项目全局 Manager，也不恢复旧 `worktree_apply`；Local Preview/Rollback/Finalize 只通过 Host 权威状态机和 strict Typert Remote 暴露给用户操作。

## 2. 已核验的 Harness 扩展缝

### 2.1 Client ↔ Host：使用 Typert Remote

当前 Harness 的正式链路不是早期动态原型中的 `harness.handle()/host.call()`，而是：

1. Host 服务继承 `TypertRemoteService`，使用 `@Remote` 或 `@RemoteScope` 标记公开方法；
2. Typert build 生成 package-private `./remote` contribution；
3. Client 通过已安装的 `remote` Service 执行 `ctx.remote.$mount(contribution)`；
4. 调用结果先经过 Gateway 的 transport `RemoteResult`，再由插件 Client adapter 归一化为 `WorktreeConsoleOutcome<T>`；
5. Remote 参数和返回值必须由 strict codec 覆盖且可 JSON 序列化。

证据入口：

- `packages/api/remotes/README.zh.md`
- `packages/api/remotes/src/client/index.ts`
- `packages/api/gateway/src/index.ts`
- `packages/api/gateway/src/client/index.ts`
- `packages/goal/goal/src/index.ts`
- `packages/host/plugin-inventory/src/index.ts`
- `packages/typert/generator/README.md`

`@deepseek-ai/dsh-api-remotes/client` 的贡献集合是构建时显式选择的，不会自动发现第三方插件。Backend Track 必须验证独立 npm 包的 package-mode Typert 生成，发布自己的 `./remote` contribution，并由本插件 Client 半显式 mount；不得假设把 Host Service 装进 profile 后 Client namespace 会自动出现。

### 2.2 UI Slot

当前 Harness 已确认可用：

- `conversation.input.left`：blank Local Session 的 pre-session Worktree switch；
- `conversation.session.header.actions`：Session 级 Target 状态胶囊与关联 Manager 入口；
- `conversation.view`：Harness seam 仍可用，但当前不注册 Worktree Console tab，避免与 Header Manager、Review 卡重复；
- `shell.overlay`：根级抽屉或弹层；
- `tool.call.toolview`：现有 Create/Ready 对话卡片。

推荐的 Harness-native 组合：

- blank Local composer 的 input-left switch 点击后只打开确认弹窗；用户确认后才 block source、准备并打开 target，再把后续发送交还标准 composer；
- Header action 显示 `Local / Worktree · Working / Ready / Recovery`，点击后提供当前目标详情、工作位置、来源 Session、关联 Manager 与 capability 驱动的 lifecycle 操作；
- Worktree Console 通过 Header 打开的 Modal 承载同一 `sourceSessionId + projectId + canonical localRoot` 关联组，暂不挂载 `conversation.view` 页签；
- source 与任一 owner target 都可查看关联组；兄弟 target 只有 path-free list 与 identity-validated open（Client 内部仍通过 inspect 取得当次授权路径），mutation 继续由各自 owner/source 特例控制；
- Manager 行只展示状态、导航和 owner lifecycle 操作，不重复挂载 Inspect 展开详情或 Review 面板；自动 Preflight、stale/conflict 恢复、slot-holder 导航与 Delivery Proof 由专用 Review 卡和 composer dock 承担；
- 只有真实使用证明需要常驻工作台时，才重新评估 view tab；跨项目全局入口仍是长期能力；
- ToolView 继续承担这次调用的上下文记录，不承担全局发现入口。

### 2.3 Workspace/Session

创建后的 authoritative target 仍使用现有公共缝：

```text
adapter.create({ sourceSessionId })
→ workspaces.create({ path: managedRoot })
→ sessions.create({ workspaceId, sessionId: targetSessionId })
→ conversation.input.for(targetBinding.ctx).setDraft/addImages
→ sessions.open(targetSessionId)
```

pre-session flow 不拦截私有 submit sink：点击开关只冻结一份确认时草稿快照并打开受控弹窗，不创建 Host 资源；用户确认后才通过 `conversation.blocks` block source composer。target input 写入成功且 source `draftRev`、文本、附件仍与确认快照一致后才打开；随后第一条消息仍由 Harness 标准 composer 发送。Host 分配 `targetSessionId`，Client 不得自行选择 owner identity。target Session 持久化 cwd 必须 canonicalize 为 `managedRoot`，否则 fail closed。失败时 source draft 保持原样；若 checkout 已创建，Client 先按 target/source caller 边界请求 Discard，只有确认 Discard 成功后才归档 target Session、删除临时 Workspace。

## 3. 共享状态模型

Console 状态由 domain facts 单向投影，不创建第二套持久状态机：

| Console state | Domain 来源 |
| --- | --- |
| `local` | Local target |
| `creating` | Isolated `phase=preparing` |
| `working` | Isolated ready + working/default delivery |
| `ready_for_review` | delivery `ready_for_review` |
| `preview_active` | delivery `preview_active`，Local 有未提交、可撤回 Preview |
| `preview_detached` | delivery `preview_detached`，Local 漂移且恢复证据已保留 |
| `retained` | phase/delivery retained |
| `cleanup_pending` | phase/delivery finalized、清理尚未完成 |
| `recovery_required` | phase `recovery_required`，优先于旧 delivery 标签 |
| `delivered` | delivered 或已 discarded 的历史投影 |

唯一实现是 `consoleStateFromDomain()`。Backend 不得自行返回另一套字符串；Client 不得通过按钮 loading 状态覆盖持久 lifecycle。

## 4. Remote/Adapter 方法

共享 `WorktreeConsoleAdapter` 包含：

- `current`
- `list`
- `create`
- `inspect`
- `reviewDiff`
- `preflight`
- `preview`
- `rollbackPreview`
- `discard`
- `finalize`（Ready 跳过验收直接提交）
- `finalizePreview`
- `setRetention`
- `retryCleanup`

关键约束：

- `list` 返回 path-free summary；
- `managedRoot` 只在 caller 已通过身份验证的 create/current/inspect detail 中出现；
- create request 只带 source Session ID，target Session ID 必须由 Host 分配；
- preflight 是严格只读操作，绑定 checkout ID、expected revision 和 expected review ID；不得创建可执行 plan、slot、Git ref 或 Local 写入；Ready 后 Client 可以自动运行并在 Review 卡/dock 间按 identity 复用结果，但任何 Preview/direct Finalize 前都必须 bypass 缓存重新检查；
- `project_acceptance_busy` 的 blocker 只包含 checkout ID、owner Session ID 与状态，不含路径；等待 owner 保留 `preflight`，但 `preview`/`finalize` capability 关闭；
- slot-holder 导航必须调用 Host `inspect`，且跨 source 窄授权只对“当前 Ready owner 的真实 acceptance holder”开放；Client 随后复验 checkout/owner/target/canonical cwd，兄弟仍不获得 mutation capability；
- preview 必须在同一 Host mutation lock 下重新 plan/CAS，先持久化 receipt 和 internal refs，再写 Local；同一 canonical localRoot 只能有一个 active slot；
- rollbackPreview/finalizePreview 必须绑定最新 revision，并复验 receipt 中的 Local HEAD/ref/fingerprint 与 Preview tree；rollback 只可跨越同一 ref 的可证明 fast-forward：先将 Preview 前 Local 层三方重放到新 HEAD，再证明新 HEAD 未包含 Preview 增量，最后反向移除 Preview并执行写前/写后 CAS；切分支、non-fast-forward、Preview 已入历史或 hunk 冲突继续 fail closed；
- discard 必须带 checkout ID、expected revision 和显式 `confirmDirty`；active Preview 还必须带 `rollbackPreview: true`，且 Host 只在 rollback 成功后删除 Worktree；
- finalize/finalizePreview 必须带 checkout ID、expected revision、expected review ID、1–500 字符用户确认 Commit Message 和 retention；Commit Message 不是授权材料，Host 必须重新做长度/空白校验并继续执行完整 review/CAS 校验；
- reviewDiff 绑定 expected revision + expected review ID，若 fingerprint/head 已变则返回 stale，不展示未审阅 bytes；该能力保留在高级控制面，不进入普通验收卡；
- 所有 mutation response 返回新的 summary/revision，Client 不乐观伪造 durable 状态；Finalize 后 summary 可带 Delivery Proof，包括 Commit、Local branch/HEAD、changed files、validation evidence 和动态 `commitInLocalHistory`，但 proof 不构成后续写权限。

## 5. 权限与 CAS 矩阵

| 操作 | caller | project/cwd | owner/source | CAS |
| --- | --- | --- | --- | --- |
| current | 精确 Session | lookup 与持久项目一致 | 当前 binding | read-only identity check |
| list | 精确 Session | 同一 project/source/canonical localRoot 关联组 | source、owner target；兄弟仅只读投影 | 无 mutation 授权复用 |
| create | source Session | canonical Git project | source 必须 Local | Host 分配 target ID；幂等/并发锁 |
| inspect | caller Session | checkout 属于已证明的关联组；目标 root identity 重验 | owner/source、同源 linked target 只读，或当前 Ready owner 的精确 slot holder 窄只读 | 返回当次 revision；Client 再验 cwd |
| reviewDiff | owner/source 规则由 Backend 明确；默认 owner | 同上 | review 必须仍为当前 | revision + reviewId + fingerprint/head |
| preflight/preview | isolated owner | Local acceptance project 与 target project 一致 | 仅 owner；busy 时 preflight 仍只读可用，preview/finalize 关闭 | revision + reviewId + isolated fingerprint/head + Local CAS；写前强制重检 |
| rollbackPreview | isolated owner | receipt 的 canonical Local boundary | 仅 owner | revision + Preview receipt + same-ref ancestry + Local HEAD/ref/fingerprint + post-write tree/index |
| discard | owner；未打开 reservation 可允许 source | 同上 | 不信任 persisted owner ID 作为 caller 证明；active Preview 先 rollback | expectedRevision + confirmDirty + rollback intent |
| finalize | isolated owner | Local acceptance project 与 target project 一致 | 仅 owner；Ready direct finish | revision + reviewId + fingerprint/head + Local CAS |
| finalizePreview | isolated owner | receipt 的 canonical Local boundary | 仅 owner | revision + reviewId + receipt + Local/ref CAS |
| setRetention/retryCleanup | caller-scoped manage | 同上 | owner/source 按现有管理语义 | expectedRevision |

Remote 的 wire `sessionId` 必须先解析为 live/recoverable Agent/Session，再把其 ID传给现有 `*ForSession()` 方法。浏览器传入的 `projectId`、`ownerSessionId`、`managedRoot`、Commit Message 都不是授权材料；Commit Message 仅作为显式用户确认的提交内容，不能改变 caller/project/review/CAS 权限判断。

## 6. 错误契约

Domain 与 transport 错误统一映射为：

- category：`permission / stale / confirmation / recovery / conflict / unavailable / invalid / internal`
- recovery：`none / refresh / confirm_dirty / open_recovery / retry`
- `retryable`：只表示同一用户意图在刷新/确认/短暂等待后可能重试，不表示可以绕过校验。

唯一映射是 `worktreeConsoleErrorMeta()`。各 UI 不得按 message 文本猜测恢复按钮。

Host 业务方法应把预期失败转为 `WorktreeConsoleOutcome<T>`；Gateway transport failure 再由 Client adapter 映射为 `transport_unavailable` 或 `malformed_response`。这样不会把所有 domain error 折叠成 Gateway `internal`。

## 7. Diff 安全与预算

Review Track 只能显示与当前 review identity 绑定的只读 diff：

- stale review 必须整体失败，不得混入 Ready 后新修改；
- binary file 返回 `patch: null`；
- Backend 应设置文件数、单文件 patch、总 payload 上限，并用 `truncated` 明示；
- patch 内容不得成为 mutation input；
- 不支持 hunk acceptance；Preview/rollback 使用 Host 内部 tree/receipt，不使用浏览器提供的 patch bytes。

建议初始预算：最多 200 files、单文件 100 KiB、总响应 1 MiB；Backend Track 可根据 Harness Gateway 限制下调，但必须记录并测试。

### 7.1 Review / Recovery P1-A

- 自动 Preflight 的共享缓存键是 `sessionId + checkoutId + revision + reviewId`，只用于避免 Review 卡与 composer dock 重复读取；强制重检会覆盖该只读快照。
- `stale_local` 表示 Local 事实已变化，不自动废弃 Review；Client 停止当前写操作并刷新 Preflight。`stale_isolated` 或 review/revision 身份变化会使旧 Preview/Finalize 立即失效。
- Delivery Proof 在 direct Finish、Finalize Preview 和 branch-CAS crash reconcile 中复制准确 Review 的 validation evidence；历史 version-2 proof 可缺少新增字段。
- `commitInLocalHistory` 是读取时动态证据：`true` 表示 Commit 仍是当前 Local HEAD 祖先，`false` 显示警告，`null` 表示当前无法确认。三者都不改变 capability。

### 7.2 Recovery continuation P1-B

- conflict 与 `stale_isolated` 是两个不可互换的 discriminated request 类型。conflict 在用户明确点击后先强制重检 `checkoutId + reviewId + revision + localHeadOid + conflictingFiles`，再调用 owner-only `resumeRevision`；`stale_isolated` 保持 Ready，不调用 `resumeRevision`，只允许 Read Only 验证与新 Ready Review。
- Preview/direct Finish 在写前 Host plan 中发现的竞态冲突，使用 strict `worktree_apply_conflict` continuation 返回 checkout/review/revision、Local HEAD 与最多 500 个安全相对冲突路径；该错误上下文不授予 mutation capability。用户点击恢复后，Host 在 mutation lock 内重新执行 conflict Preflight/CAS，生成新的随机 request ID，并把绑定 Ready/Working revision、review、Local HEAD 与冲突文件的 recovery proof 持久化到 registry。
- `stale_isolated` 点击后先调用 owner-only `prepareReviewRegeneration`：Host 重新只读 Preflight，并在不改变 Ready revision、不修改文件的前提下持久化独立 `worktree_review_regeneration` proof。两类 proof 不可互换，后续 Ready/Working 状态或 Review 变化会使其失效。
- Client 只通过 Harness 官方 `ISession.prompt(content, 'queue')` 发送；发送前和实际 prompt 前都必须由 `inspect` 取回与请求逐字段相等的 Host proof，并证明 exact owner Session、active Session、canonical cwd、checkout、revision 和 recovery kind。无法证明时 fail closed。
- continuation 请求以 versioned browser storage 持久化 `queued/sending/failed` 上下文，以便页面刷新后恢复未发送工作；browser storage 是不可信上下文而不是权限记录，必须严格校验穷举 kind、精确字段集合、长度/OID/安全相对路径预算，并在每次恢复和发送前重新检查 Host proof、Session 与 cwd。重复点击复用同一 request ID；新请求取代旧请求；Session 切换中止并消费旧请求；明确 `queued` 可在刷新后继续，刷新时处于 `sending` 的请求因结果未知而降级为显式“重新发送”，避免自动重复投递；重试不重放 Host mutation。
- Agent conflict prompt 只允许在 managed Worktree merge 最新 Local HEAD、解决冲突、聚焦验证并重新 Ready；禁止自动 Preview/Finalize/写 Local。review regeneration prompt 明确禁止修改文件，只在写入停止后复核并重新 Ready。
- acceptance slot 从 `waiting` 变为 `available` 时，Client 使旧 busy Preflight 失效并重新读取；自动 Preflight error 保持缓存，避免重渲染循环请求，只有显式“重新检查”才 force retry。

## 8. 并行文件所有权

### Shared foundation（本轮后冻结）

- `src/console-contract.ts`
- `tests/support/worktree-console.ts`
- `docs/WORKTREE-CONSOLE-ARCHITECTURE.md`
- 三份 `docs/handoffs/worktree-console-*.md`

三个并行 Worktree 不得自行改变共享 DTO 字段或状态。发现契约阻塞时，在交付报告中提出，不直接分叉协议。

### Backend Control Plane 独占

- 新增 `src/console-host/**`
- 新增 `src/client/console-remote/**`
- Host Remote tests
- Typert/package build 与 Remote publication 配置
- `src/index.ts`、`package.json`、`tsdown.config.ts` 中与 Remote wiring 相关的区域

### Session Target UI 独占

- 新增 `src/client/target-console/**`
- Header 状态胶囊、保留但暂不挂载的 Worktree Console、Create/Open
- target UI component tests
- `src/client/index.tsx` 中 Slot wiring 区域

### Review UI 独占

- 新增 `src/client/review-console/**`
- 现有 `WorktreeReviewRow.tsx` 的 Review 展示演进
- review/diff component tests

### 共享入口集成

三个 Worktree 都从同一 foundation commit 开始。建议合并顺序：Backend → Review → Session Target UI，最后单独做一次小型 integration pass，统一：

- Client `inject` 和 `ctx.remote.$mount()` 生命周期；
- `src/client/index.tsx` 的 ToolView、Target Console 与 Pre-session registrar；
- package exports/files；
- Client bundle smoke 与真实浏览器 E2E。

任何一条并行线都不得通过复制 shared contract 来“避免冲突”。

## 9. 非目标

- 不修改 DeepSeek Harness；
- 不恢复模型侧 Apply/Finish/Discard；
- 不把 Local Preview/Rollback 暴露为模型工具，也不允许浏览器选择 Local 路径、slot owner 或 receipt；
- 不实现 hunk acceptance；
- 不实现跨项目全局 Manager；
- 不实现 workflow `agent({ isolation })`；
- 不在 UI 内通过隐藏 prompt 让模型代替用户点击 Create/Finalize。
