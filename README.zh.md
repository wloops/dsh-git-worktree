# dsh-git-worktree

面向 DeepSeek Harness 的**实验性** Git Worktree Session Target 插件。它保留 Domi 中经过生产验证的 checkout / apply engine 安全核心，并按 Harness 的权威 Workspace / Session cwd 模型重做产品闭环。

> 当前范围：真实隔离 Session、Ready-for-Review ToolView、用户确认后的 task-only Finish、保留策略、崩溃恢复、指纹 CAS 与保守清理。它还不是 Domi Worktree Manager 或可逆 Local Preview 的完整替代品。

## 工作流程

1. 在 Local Session 中，模型调用 `worktree_create`。
2. 插件在仓库同级容器中创建唯一 detached Worktree（不可用时回退到插件 stateDir），并预留一个独立 target Session ID；源 Session 始终保持 Local。
3. Create ToolView 的**打开隔离会话**按钮把 Worktree 路径注册为 Harness Workspace，使用预留 ID 创建 Session 并打开。持久化 Session header 的 cwd 才是权威 Session Target。
4. Agent 只在该 isolated cwd 中修改和验证，完成后把 `worktree_ready_for_review` 作为最后一个模型操作。
5. Review ToolView 展示 changed files、验证证据和建议 Commit Message；用户选择**提交并清理**或保留 24 小时 / 3 天 / 手动保留。
6. `/worktree finalize ...` 在 Local 上创建一个只含任务增量的 commit，同时保留用户原有 staged、unstaged 与 untracked 工作。

## 能力面

### 模型工具

| 工具 | 作用 |
| --- | --- |
| `worktree_create` | 预留唯一 Worktree 与独立 owner Session；不会修改当前 Session cwd |
| `worktree_list` | 仅列出当前 Session 在原始项目中拥有或创建的 Worktree |
| `worktree_ready_for_review` | 持久化完整交付报告并停止，等待用户验收 |

Apply、Finish、Discard、Remove **不再作为模型工具**暴露。模型参数不能替代可信的用户授权。

### 用户命令

```text
/worktree status
/worktree list
/worktree finalize [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <自定义 Commit Message>
/worktree discard
/worktree remove <checkoutId>
```

Client ToolView 以用户身份调用 `finalize`，并携带该卡片精确的 review ID 与 revision。Finish 在触碰 Local 前会再次核对已审阅 fingerprint/head；历史卡片或 Ready 后新增修改必须重新生成 Ready 快照。命令还会验证 owner/source 作用域、原始 project 身份和 managed cwd 身份。

## 安全不变量

- source 与 target 使用不同 Session ID；不会再用插件私有 registry 把 Local Session 伪装成 isolated。
- target Harness Workspace 必须 canonicalize 到记录的 managed root，否则访问 fail closed。
- Worktree 路径唯一且通常位于 Local 仓库之外，Local `git status` 和备用 index 不会把它误收为 gitlink。
- 已走过旧版不可逆 Apply 的历史记录禁止自动 Finish / Discard，必须先人工核对 Local。
- list 与 manage 都按真实 caller 作用域过滤；持久化 `ownerSessionId` 本身不是授权。
- Finish 保留 Local 无关 staged/working 状态，并拒绝 stale Local / stale Isolated。
- 清理前验证路径、Git common-dir、git-dir、目录身份和最终指纹；不确定残余会保留或 quarantine。

## 安装

```bash
# npm（推荐）
dsh plugin --profile web add dsh-git-worktree

# Git 源码安装（prepare 构建 Host + Client bundle）
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.1.2
```

pnpm >= 10 可能会拦截 Git 依赖的构建脚本；在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下加入 `dsh-git-worktree: true` 后重试。

要求 DeepSeek Harness `0.1.0-rc.6` 包线；交互 ToolView 需要 Web Client。

## 一键本地开发测试

持续迭代时，在任意当前 checkout（包括 Domi managed Worktree）中运行：

```bash
pnpm run dev:dsh
```

该命令会自动执行 typecheck/build，把**当前 checkout 快照**打成 OS 临时目录中的本地 tarball，安装到 `web` profile，检查组合配置，创建或复用 marker 保护的临时 Git fixture，最后从 fixture cwd 启动 `dsh web`（默认 `http://127.0.0.1:3081`）。如果检测到同一开发目录下的 `DeepSeek/deepseek-harness` 源码 checkout，会优先用它启动 DSH，同时仍把 Session workspace 保持为 fixture；也可用 `DSH_HARNESS_ROOT` 或 `--harness <path>` 指定。找不到源码 checkout 时才使用 PATH 中已安装的 `dsh`。它不会运行 `npm publish`、Git push 或创建 tag，也不会留下指向已清理 managed Worktree 的软链接。profile 当前引用的 tarball 会保留，成功安装新快照后会清理旧 tarball。

常用入口：

```bash
# 只安装当前快照并验证配置，不启动 Web
pnpm run dev:dsh:install

# 只检查已安装 profile
pnpm run dev:dsh:smoke

# 使用现有 Git 仓库或其他端口/profile
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web

# 显式从 profile 卸载，并清理本地开发 tarball
pnpm run dev:dsh:remove
```

默认 fixture 位于系统临时目录 `dsh-git-worktree-dev/fixture`。它只会初始化不存在或为空的目录；复用时必须具有插件 marker、Git 根身份正确、状态干净且没有遗留 linked Worktree。遇到未知文件、脏状态、符号链接或残留 Worktree 会 fail closed，脚本绝不会自动 reset 或删除内容。显式 `--repo` 必须指向已经存在的 Git 根，脚本只验证、不初始化或改写它。

## 当前限制

- 尚无可逆 Local Preview / Finalize / Rollback 层；旧 `worktree_apply` 入口已禁用。
- 尚无全局侧栏 Worktree Manager；本版提供 Session 内的 Create 与 Review ToolView。
- Harness 仍未开放 Workflow `agent({ isolation })`。
- 子 Agent 继承父 Session cwd；只有父 Session 已真实进入 Worktree 后才形成隔离。
- dependency snapshot、完整 collaborator handoff UI 延后。
- 选择立即清理后，isolated Session 的 cwd 会被删除，因此该 Session 视为终态；后续应回到 Local 或开启下一轮 Session。

Domi 与 Harness 的边界见 [docs/PORTING.md](docs/PORTING.md)，发布门禁见 [docs/RELEASE.md](docs/RELEASE.md)。

## 许可证

MIT
