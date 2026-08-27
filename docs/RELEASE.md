# Release checklist（发布清单）

发布门禁必须同时覆盖 Host、Client、tarball 与真实安装。`check-publish` 默认允许 managed Worktree 的未提交 review 状态；正式发布 CI 必须额外设置 `CHECK_PUBLISH_REQUIRE_CLEAN=1`。

## 1. 同一快照构建与验证

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run check:publish
pnpm pack --dry-run
```

当前 `check-publish` 断言：

- `cordis.patch.yml` 存在、会进入 tarball，并插入本包 Host row；
- `package.json.exports` 的每个 default/types/path target 都真实存在且受 `files` 覆盖；
- Host `lib/index.js` 命名导出 `apply` 与 `inject`；
- `dsh.client` 声明 Web 平台和 client injection；
- `lib/client.js` 执行时调用 `window.__ModuleLoader__.load({ id, factory })`，注册 ID 精确等于包名，且 factory 返回 Client `apply` 与 `inject`；
- Typert Loader/Remote discovery 必须从本轮刚生成的 `lib` 读取完整方法面；当前包括 generation-bound `checkpoint`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff` 与 proof-bearing Rollback/Finalize，source descriptor 和 build artifact 不一致会阻断发布；
- 失效 export（例如历史 `./manager`）会直接阻断发布。

正式发布或 tag CI 使用：

```bash
pnpm run check:publish:release
# 等价：CHECK_PUBLISH_REQUIRE_CLEAN=1 pnpm run check:publish
```

## 2. 功能 smoke

在临时 Git 仓库和 scratch Harness profile 中验证：

1. Local Session 调用 `worktree_create`；Local `git status --porcelain` 不出现 Worktree 路径。
2. 连续创建两个 target，checkout/path/sessionId 均唯一。
3. Create ToolView 注册 Workspace，并打开精确预留 Session ID。
4. 新 Session header cwd 等于 managed root；Read/Write/Bash 实际落在 Worktree。
5. `worktree_ready_for_review` 显示 changed files、tests、validation 和 Commit Message。
6. “提交并清理”产生一个 task-only Local commit；Local 原有 staged/unstaged/untracked 保留。
7. 24h / 3d / manual retention 写入正确状态。
8. 另一个 Session 即使属于同一项目，也不能 list/remove 不属于它的 Worktree。
9. target Workspace cwd 被替换时，插件返回 `project_mismatch`。
10. 历史 `applyBaseOid` 记录拒绝自动 Finish/Discard。
11. 制造同分支 Local fast-forward 使 Preview 进入 `preview_detached`；Recovery Preflight 不改变 Local HEAD/ref/index/worktree、registry 或 retained refs，并只在 Host proof 标记 safe 后显示撤回/提交。
12. 在 recovery proof 生成后改变 Local、retained artifact 或 acceptance-slot holder；旧 generation 必须在 journal/Local 写入前以 stale/blocked 结果拒绝。
13. detached Rollback/Finalize 保留后续 Local Commit 与 staged/unstaged/untracked 层；写后验证 fault 进入 `recovery_required` 并保留 journal，不把 matching Commit HEAD 猜成成功。
14. Recovery analysis prompt 明确只读；fresh Worktree handoff 从最新 Local HEAD 创建，任何失败都不改变旧 detached delivery、receipt、refs、Local 或旧 Worktree。
15. 在 Ready Review 点击“保存阶段并继续”：Worktree 产生一个阶段 Commit、状态回到 clean Working、Review/Preview/proof 失效，Local HEAD/branch/index/staged/unstaged/untracked/文件 bytes 与 refs 完全不变。
16. 对同一 checkpoint request ID 重复提交只返回同一阶段；旧 revision/review/generation、外来 Session、acceptance slot busy、空阶段与重复点击均在写入前拒绝或去重。
17. active Preview 点击“保存阶段并继续”：Host 原子撤回 Preview 后保存 Worktree 阶段；制造 rollback fault 时必须保留 journal/artifacts 与恢复证据，不能继续创建 Checkpoint。
18. 重启 Host 后恢复 `checkpoint` journal：prepared commit 尚未移动 HEAD、HEAD 已移动但 index 未清理、内部 ref 已保留等中断点都应收敛或进入 `recovery_required`；不得留下未知 `index.lock` 或泄漏内部 refs 到 Remote。
19. 连续保存至少两个阶段后完成 Finalize；Local 最终只新增一个累计任务 Commit，Review/Manager 只展示阶段摘要/数量，Manager 不出现 Checkpoint mutation 控件。

## 3. 版本、提交、CI 与 tag

先在受管 Worktree 中 bump version 并更新 docs/changelog，完成 Local 验收提交后，再在 clean Local 上运行：

```bash
pnpm run check:publish:release
git push origin <release-branch>
# 等待该精确 release commit 的 GitHub Actions 成功
git tag -a v<版本> -m "v<版本>"
git push origin v<版本>
```

当前 release branch 是 `master`，CI 同时监听 `master` 与 `main`。不要在脏工作区创建 release tag；不要依赖未提交的 `prepare` 修复；branch CI 未通过时不得 tag 或 publish。

## 4. 发布

```bash
npm publish
```

`prepublishOnly` 会重跑 build、clean-tree publish gate 与 tests。发布前必须确认 npm 身份有效且目标版本尚未占用。pnpm >= 10 的 Git 安装需要 profile `allowBuilds` 允许 `dsh-git-worktree` 的 `prepare`。发布失败时保留已经推送的 release commit/tag 并报告；不得移动或覆盖 tag。

## 5. 发布后真实安装

```bash
dsh plugin --profile <scratch> add dsh-git-worktree@<版本>
dsh --profile <scratch>
```

确认：

- profile bundle rows 含 `dsh-git-worktree`；
- Host 启动无 missing inject/export 错误；
- Web Client 加载 `./client`，Create/Review ToolView 不是 generic card；
- 浏览器控制台无 `ModuleLoader`、React duplicate、slot duplicate 或 CSS teardown 错误；
- npm tarball 与 Git tag 安装都通过。

全部通过后再升级正式 profile。

## 历史教训

| 问题 | 门禁 |
| --- | --- |
| 包安装但 Host 不挂载 | `cordis.patch.yml` + patch row 检查 |
| Host 入口缺少 `inject` | Host export 检查 |
| `./manager` 指向不存在文件 | 全量 exports 遍历 |
| Client 脚本加载成功但没有注册 ModuleLoader factory | 在 VM 中按真实浏览器协议执行脚本，断言 `__ModuleLoader__.load` 的 ID/factory/apply/inject |
| Git 安装从旧 commit 构建 | release CI 的 clean-tree 检查 + tag 后真实安装 |
| 表面绑定 isolated、实际 Session cwd 仍是 Local | scratch profile 的真实 Session header/文件工具 smoke |
