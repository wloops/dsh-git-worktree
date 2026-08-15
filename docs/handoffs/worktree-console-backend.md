# 并行交接 1：Backend Control Plane

## 任务目标

实现 Worktree Console 的可信 Host Control Plane 和 Client Remote adapter，使 UI 可以不经过模型调用完成 current/list/create/inspect/reviewDiff/discard/finalize/retention。只做 API、安全边界、投影和传输，不实现 Target/Review React UI。

共享基线：

- [`../WORKTREE-CONSOLE-ARCHITECTURE.md`](../WORKTREE-CONSOLE-ARCHITECTURE.md)
- [`../../src/console-contract.ts`](../../src/console-contract.ts)
- [`../../tests/support/worktree-console.ts`](../../tests/support/worktree-console.ts)

开始前读取上述文件以及 Harness：

- `packages/api/remotes/README.zh.md`
- `packages/api/remotes/src/client/index.ts`
- `packages/api/gateway/src/index.ts`
- `packages/api/gateway/src/client/index.ts`
- `packages/goal/goal/src/index.ts`
- `packages/host/plugin-inventory/src/index.ts`
- `packages/typert/generator/README.md`

不得修改 Harness 仓库。

## 必须遵守的架构

1. 使用 Harness 正式 Typert Remote：`TypertRemoteService + @Remote`、生成 `./remote` contribution、Client `ctx.remote.$mount()`。
2. 不使用历史文档中的 `harness.handle()/host.call()`，除非先证明当前 Harness 官方 bundle 正在使用该缝；当前源码证据指向 Typert Remote。
3. Remote business method 返回 `WorktreeConsoleOutcome<T>`，不要让预期 domain failure 折叠成 Gateway `internal`。
4. Client adapter 负责把 Gateway transport `RemoteResult` 解包，并将 carrier failure 映射为 `transport_unavailable`、非法 payload 映射为 `malformed_response`。
5. Host 分配 target Session ID；Client 不能提交 owner ID、managedRoot、project ID 或任意 Commit Message作为授权材料。
6. 所有 mutation 继续调用现有 `SessionCheckoutModule`，不得复制 Git/registry 状态机。

## 文件所有权

建议新增：

```text
src/console-host/service.ts
src/console-host/projection.ts
src/console-host/errors.ts
src/console-host/review-diff.ts
src/client/console-remote/index.ts
src/client/console-remote/adapter.ts
tests/console-host.test.ts
tests/console-remote.test.ts
```

本 Track 可以修改：

```text
src/index.ts
package.json
tsdown.config.ts
scripts/check-publish.mjs
```

但只修改 Remote wiring、Typert artifacts、依赖、exports 和 publish gate 相关区域。

不得修改：

```text
src/console-contract.ts
tests/support/worktree-console.ts
src/client/target-console/**
src/client/review-console/**
src/client/WorktreeReviewRow.tsx
```

如共享契约存在阻塞，在 Ready for Review 报告中提出，不在分支内复制或改名 DTO。

## Host Service 建议

建立 `WorktreeConsoleService extends TypertRemoteService`，namespace 建议为 `gitWorktree`。服务应复用一个由 Host apply 提供的 `SessionCheckoutModule` Cordis service/reference，而不是重新创建 registry/module。

Remote 方法的 Host receiver 使用 Harness Agent/Session lookup：wire 传 Session ID，Gateway 解析为精确 Agent/Session，业务体再把该 Session ID传给现有 caller-scoped module API。

建议方法：

```text
current(agent)
list(agent, requestWithoutSessionId)
create(agent)
inspect(agent, checkoutId)
reviewDiff(agent, identity)
discard(agent, identityAndConfirm)
finalize(agent, reviewIdentityAndRetention)
setRetention(agent, identityAndRetention)
retryCleanup(agent, identity)
```

生成的 Client adapter 仍实现 `WorktreeConsoleAdapter` 的 request 形状，并负责把 `request.sessionId` 放到 Remote lookup 参数；不要在 Host business body 同时信任 request 内另一个 Session ID。

## 权限不变量

### current/list/create

- Session lookup 必须成功；
- project 从 Session lookup/现有 binding 得出；
- list 必须调用 `listManagedWorktreesForSession()`；
- create 必须确认 source Session 是 Local/unselected 可创建状态；
- target Session ID 使用 Host `randomUUID()`；
- create 并发继续受现有 project/session lock 控制。

### inspect/manage

- 必须调用 caller-scoped API；
- persisted `ownerSessionId` 只能作为数据，不能单独授权；
- checkout 必须属于 caller 原 project；
- canonical managed root、Workspace cwd、Git worktree identity 必须一致；
- list row path-free，只有通过身份检查的 details 才返回 managedRoot。

### finalize

必须同时验证：

```text
caller is isolated owner
checkoutId
expectedRevision
expectedReviewId
review is still current
isolatedFingerprint
isolatedHeadOid
Local fingerprint/head CAS
project acceptance lock
```

Commit Message 从 persisted review 读取。Remote request 不接受 commitMessage。

### reviewDiff

- 只读，不修改 registry/ref/index/worktree；
- 必须绑定 expected revision + expected review ID；
- Ready 后 bytes 改变返回 `stale_isolated`，不得展示新 bytes；
- binary 返回 `patch: null`；
- 最多 200 files、单文件 100 KiB、总 payload 1 MiB，超限设置 `truncated`；
- path 必须为项目相对路径，拒绝越界/绝对路径。

## 垂直 TDD 切片

### Slice 1：Projection

先写失败测试：Local、preparing、working、ready、retained、cleanup、recovery 都通过 `consoleStateFromDomain()` 投影；list 不包含 managedRoot。

最小实现 `projection.ts`，把现有 `SessionTargetView` / `ManagedWorktreeSummaryView` 转为共享 DTO。

### Slice 2：current/list

失败测试覆盖：

- caller 只看到自身项目和 owner/source 可见项；
- 非 owner persisted ID 不授权；
- current isolated detail 在 cwd 错误时 fail closed。

再实现 Remote business methods。

### Slice 3：create/inspect

失败测试覆盖：

- target ID 由 Host 分配；
- source cwd 不被修改；
- create response 返回精确 targetSessionId + managedRoot；
- inspect 跨 project/checkout 拒绝。

### Slice 4：reviewDiff

先测试 stale review、binary、truncation 和路径越界，再实现只读 diff 投影。不得调用旧 destructive Apply。

### Slice 5：mutations

分别测试 discard、finalize、setRetention、retryCleanup 的 revision/review identity。重点保留已有“Ready 后修改不能进入 Local”的回归。

### Slice 6：Remote contribution 和 Client adapter

先证明独立包的 package-mode Typert build 能生成并发布：

```text
./typert
./remote
lib/typert.host.*
lib/typert.remote-client.*
```

然后测试：

- Client mount contribution；
- namespace 精确为 `gitWorktree`；
- transport failure 正规化；
- business failure不丢 code；
- disposal 撤回 namespace；
- malformed payload fail closed。

如果已发布 rc.6 工具链无法为独立包生成严格 Remote artifact，停止并把精确构建错误写入交付报告；不要静默退回手写 fetch、raw connection 或隐藏 command。

## 验收标准

- `WorktreeConsoleAdapter` 所有方法有真实 Remote 实现；
- current/list/create/inspect/mutations 全部 caller-scoped；
- path 只在授权 detail 中出现；
- Review diff 严格绑定 review identity；
- finalize 不接受任意 Commit Message；
- Typert artifacts 进入 npm payload且 publish gate 检查；
- 现有 tool/command 行为保持兼容；
- 不修改 Harness。

## 验证命令

```bash
pnpm exec vitest run tests/console-contract.test.ts tests/console-host.test.ts tests/console-remote.test.ts tests/session-checkout-module.test.ts tests/surface.test.ts
pnpm run typecheck
pnpm run build
pnpm run check:publish
pnpm pack --dry-run
```

若 Remote build 修改 Client bundle，再补真实 ModuleLoader smoke。

## 非目标

- React UI；
- Sidebar/Drawer 样式；
- Local Preview/Rollback；
- 模型工具扩展；
- hunk acceptance；
- 修改 Harness api-remotes 固定组合。

## Ready for Review 要求

报告必须列出：Remote 生成方式、namespace/method 清单、权限负向测试、diff budget、transport/business error 分层、发布 payload、未解决的 Harness 版本约束。不要自行 Apply、push、tag 或 publish。
