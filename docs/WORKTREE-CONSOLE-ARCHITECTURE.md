# Harness-native Worktree Console：并行开发共享架构

## 1. 本轮边界

本文是 Backend Control Plane、Session Target UI、Review UI 三条并行 Worktree 的共同基线。共享 JSON 契约位于 [`src/console-contract.ts`](../src/console-contract.ts)，测试 fixture 位于 [`tests/support/worktree-console.ts`](../tests/support/worktree-console.ts)。

本轮只锁定可并行实施所需的状态、DTO、安全规则、Harness 扩展缝和文件所有权。它不实现完整 Manager，不恢复旧 `worktree_apply`，也不引入 Local Preview/Rollback。

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
- `conversation.session.header.actions`：Session 级状态胶囊/入口；
- `conversation.view`：Session 级 Worktree Console tab；
- `shell.overlay`：根级抽屉或弹层；
- `tool.call.toolview`：现有 Create/Ready 对话卡片。

推荐的 Harness-native 组合：

- blank Local composer 的 input-left switch 在用户点击后立即 block source，准备并打开 target，再把后续发送交还标准 composer；
- Header action 显示 `Local / Working / Ready / Recovery`；
- 点击后切换到 `conversation.view` 的 `worktree` tab；
- 只有确实需要跨列抽屉时才占用 `shell.overlay`；
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

pre-session flow 不拦截私有 submit sink：点击开关后同步通过 `conversation.blocks` block source composer，target input 写入成功后才打开；随后第一条消息仍由 Harness 标准 composer 发送。Host 分配 `targetSessionId`，Client 不得自行选择 owner identity。target Session 持久化 cwd 必须 canonicalize 为 `managedRoot`，否则 fail closed。失败时 source draft 保持原样；若 checkout 已创建，Client 先按 target/source caller 边界请求 Discard，只有确认 Discard 成功后才归档 target Session、删除临时 Workspace。

## 3. 共享状态模型

Console 状态由 domain facts 单向投影，不创建第二套持久状态机：

| Console state | Domain 来源 |
| --- | --- |
| `local` | Local target |
| `creating` | Isolated `phase=preparing` |
| `working` | Isolated ready + working/default delivery |
| `ready_for_review` | delivery `ready_for_review` |
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
- `discard`
- `finalize`
- `setRetention`
- `retryCleanup`

关键约束：

- `list` 返回 path-free summary；
- `managedRoot` 只在 caller 已通过身份验证的 create/current/inspect detail 中出现；
- create request 只带 source Session ID，target Session ID 必须由 Host 分配；
- discard 必须带 checkout ID、expected revision 和显式 `confirmDirty`；
- finalize 必须带 checkout ID、expected revision、expected review ID 和 retention；Commit Message 从持久化 review 读取，Client 不重新提交任意文本；
- reviewDiff 绑定 expected revision + expected review ID，若 fingerprint/head 已变则返回 stale，不展示未审阅 bytes；
- 所有 mutation response 返回新的 summary/revision，Client 不乐观伪造 durable 状态。

## 5. 权限与 CAS 矩阵

| 操作 | caller | project/cwd | owner/source | CAS |
| --- | --- | --- | --- | --- |
| current | 精确 Session | lookup 与持久项目一致 | 当前 binding | read-only identity check |
| list | 精确 Session | 只投影 caller 原项目 | 仅 owner 或 source 可见 | 无授权复用 |
| create | source Session | canonical Git project | source 必须 Local | Host 分配 target ID；幂等/并发锁 |
| inspect | caller Session | checkout 属于 caller 项目；root identity 匹配 | owner 或 source | 返回当次 revision |
| reviewDiff | owner/source 规则由 Backend 明确；默认 owner | 同上 | review 必须仍为当前 | revision + reviewId + fingerprint/head |
| discard | owner；未打开 reservation 可允许 source | 同上 | 不信任 persisted owner ID 作为 caller 证明 | expectedRevision + confirmDirty |
| finalize | isolated owner | Local acceptance project 与 target project 一致 | 仅 owner | revision + reviewId + fingerprint/head + Local CAS |
| setRetention/retryCleanup | caller-scoped manage | 同上 | owner/source 按现有管理语义 | expectedRevision |

Remote 的 wire `sessionId` 必须先解析为 live/recoverable Agent/Session，再把其 ID传给现有 `*ForSession()` 方法。浏览器传入的 `projectId`、`ownerSessionId`、`managedRoot`、Commit Message 都不是授权材料。

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
- 第一版不支持 hunk acceptance、Preview 或 rollback。

建议初始预算：最多 200 files、单文件 100 KiB、总响应 1 MiB；Backend Track 可根据 Harness Gateway 限制下调，但必须记录并测试。

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
- Header action、Worktree tab/Drawer、Create/Open
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
- 不实现 Local Preview/Rollback；
- 不实现 hunk acceptance；
- 不实现跨项目全局 Manager；
- 不实现 workflow `agent({ isolation })`；
- 不在 UI 内通过隐藏 prompt 让模型代替用户点击 Create/Finalize。
