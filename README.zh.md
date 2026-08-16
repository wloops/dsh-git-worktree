# dsh-git-worktree

面向 DeepSeek Harness 的**实验性** Git Worktree Session Target 插件。它保留 Domi 中经过生产验证的 checkout / apply engine 安全核心，并按 Harness 的权威 Workspace / Session cwd 模型重做产品闭环。

> 当前范围：真实隔离 Session、Harness-native Session Target/Worktree Console、可撤回的 Local Preview、验收提交/撤回/跳过验收直接提交、项目级验收槽位、持久恢复凭据、保留策略、崩溃恢复、指纹 CAS 与保守清理。它还不是 Domi 的跨项目全局 Worktree Manager。

## 工作流程

1. 在 blank/new Local Session 中，用户点击 composer 工具栏的 **Worktree** 开关后先看到确认弹窗。取消不会创建任何资源；确认后插件才冻结 Local composer、创建 isolated target，把尚未发送的文本/图片草稿迁移过去并打开 target。首条消息仍由用户在 target 的原生 composer 中发送，任何 prompt 都不会先进入 Local。
2. 已存在的 Local Session 仍可通过模型拥有的 `worktree_create` ToolView 创建 target。主流程稳定前，原项目级 **Worktree** 标签页暂不挂载。
3. 插件在仓库同级容器中创建唯一 detached Worktree（不可用时回退到插件 stateDir），并预留一个独立 target Session ID；源 Session 始终保持 Local。
4. Harness 把 Worktree 路径注册为 Workspace，使用 Host 预留的精确 ID 创建并打开 Session。持久化 Session header 的 cwd 才是权威 Session Target。
5. Agent 只在该 isolated cwd 中修改和验证，完成后把 `worktree_ready_for_review` 作为最后一个模型操作。
6. Worktree Ready 后，target composer 上方常驻 Domi 式中文状态条；紧凑验收卡默认只展示摘要、验证状态、文件数量和折叠的测试证据，不再展示 Diff/Inspect 或平铺多个保留按钮。
7. Ready 主操作是**同步到 Local 验收**：Host 先执行只读 preflight，再把精确 review 增量同步成不提交、可撤回的 Local Preview。Preview active 后主操作变为**验收通过并提交**；更多菜单可撤回本次预览并让 Worktree 回到继续修改状态。Ready 更多菜单还提供**跳过验收，直接提交**与放弃任务。
8. Preview、rollback 和 finalize 都绑定 revision、review ID、HEAD 与 fingerprint CAS。同一 Local 项目同时只允许一个活动 Preview；放弃 active Preview 时必须先安全 rollback。rollback 可在分支未变且 HEAD 仅安全快进时，通过三方树证明只移除 Preview、保留新 Commit 与原 Local 层；切分支、改写历史、Preview 已进入 Commit 或内容冲突仍 fail closed，保留 Worktree 与恢复凭据，绝不覆盖用户修改。

## 能力面

### 模型工具

| 工具 | 作用 |
| --- | --- |
| `worktree_create` | 预留唯一 Worktree 与独立 owner Session；不会修改当前 Session cwd |
| `worktree_list` | 仅列出当前 Session 在原始项目中拥有或创建的 Worktree |
| `worktree_ready_for_review` | 持久化完整交付报告并停止，等待用户验收 |

Apply、Finish、Discard、Remove **不再作为模型工具**暴露。模型参数不能替代可信的用户授权。

### Harness-native Worktree Console

Client 通过官方 Gateway 挂载本包拥有的 strict Typert Remote contribution。blank Local Session 会在 Harness 官方 `conversation.input.left` composer 工具栏 Slot 中显示紧凑的 **Worktree** 开关；点击只打开确认弹窗，确认后才准备 Host 分配的 target，并在导航前迁移尚未发送的文本/图片草稿，标准 Harness Send 仍是唯一 prompt 路径。每个持久 Session 都可看到只读 target 状态胶囊；Ready 后由 `conversation.input.dock` 显示始终可见的紧凑验收条，只保留一个主操作和“更多”菜单。高级 `WorktreeConsoleView`、Host 控制面和 strict Remote 方法仍完整保留，但 v0.2.0 暂不挂载项目级 `conversation.view` 标签页。列表行不包含路径；只有通过身份验证的 `current`、`create` 或 `inspect` 才返回 managed root。

### 用户命令

```text
/worktree status
/worktree list
/worktree finalize [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <自定义 Commit Message>
/worktree discard
/worktree remove <checkoutId>
```

Client 通过 strict Remote 调用 `preflight`、`preview`、`rollbackPreview`、`finalizePreview`，或在用户明确选择跳过验收时调用 `finalize`。所有路径携带精确 review ID/revision；提交路径还携带用户确认的 1–500 字符 Commit Message 与 retention。Host 会再次校验 caller、project、managed cwd、review、HEAD/fingerprint 和 Local CAS；历史卡片、Ready 后新增修改或 Local 漂移都 fail closed。

## 安全不变量

- source 与 target 使用不同 Session ID；不会再用插件私有 registry 把 Local Session 伪装成 isolated。
- Worktree 开关的确认弹窗不创建资源；用户确认后 Pre-session 事务才同步 block source composer。只有 managed Workspace、精确 target Session、草稿迁移与 source draft revision CAS 全部成功后才打开 target，失败时 source 草稿保持原样。
- target Harness Workspace 必须 canonicalize 到记录的 managed root，否则访问 fail closed。
- 新 Worktree 使用 `<repo>--worktrees/<repo>--<checkout-short>--worktree`；短 ID 冲突时扩展 identity，不覆盖未知目录。不安全 sibling 回退到 `<stateDir>/worktrees/<repository-key>/`，旧 registry 路径仍可管理。
- 已走过旧版不可逆 Apply 的历史记录禁止自动 Finish / Discard，必须先人工核对 Local。
- list 与 manage 都按真实 caller 作用域过滤；持久化 `ownerSessionId` 本身不是授权。
- Preview receipt 在触碰 Local 前持久化并保留 Local working tree、index、Preview tree 与 Isolated snapshot；rollback/finalize 可在 Host 重启后恢复；同分支 fast-forward rollback 会先证明新 HEAD 未包含 Preview，再重放原 Local 层并做写前/写后 CAS。
- 同一 canonical Local root 只有一个活动验收槽位；Preview detached 会释放槽位，但保留恢复证据。
- Finish 保留 Local 无关 staged/working 状态，并拒绝 stale Local / stale Isolated；active Preview 的 Discard 必须先安全 rollback。
- 清理前验证路径、Git common-dir、git-dir、目录身份和最终指纹；不确定残余会保留或 quarantine。

## 安装

```bash
# npm（推荐）
dsh plugin --profile web add dsh-git-worktree

# Git 源码安装（prepare 构建 Host + Client bundle）
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.2.0
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

- 旧 `worktree_apply` 入口仍禁用；公开交付路径只允许用户触发的 Preview/rollback/finalize/direct finish。
- 尚无跨项目全局侧栏 Manager。项目级 Worktree Console 实现仍保留用于恢复与后续重做，但其可见 `conversation.view` 标签页暂不挂载。
- Harness 仍未开放 Workflow `agent({ isolation })`。
- 子 Agent 继承父 Session cwd；只有父 Session 已真实进入 Worktree 后才形成隔离。
- dependency snapshot、完整 collaborator handoff UI 延后。
- 选择立即清理后，isolated Session 的 cwd 会被删除，因此该 Session 视为终态；后续应回到 Local 或开启下一轮 Session。

Domi 与 Harness 的边界见 [docs/PORTING.md](docs/PORTING.md)，发布门禁见 [docs/RELEASE.md](docs/RELEASE.md)。

## 许可证

MIT
