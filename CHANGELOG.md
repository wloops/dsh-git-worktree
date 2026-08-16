# Changelog

本项目的显著变更记录在此文件中。版本号遵循 Semantic Versioning；在 `0.x` 阶段，minor 版本可能包含需要迁移的公开能力调整。

## [0.2.0] - 2026-08-17

`0.2.0` 将插件从单一 Worktree 管理器升级为 DeepSeek Harness 中完整、可验收、可撤回的 Worktree Session Target。

### Added

- 真实 source/target Session 分离：Host 分配唯一 checkout、managed root 与 target Session ID，source Session 始终保持 Local。
- blank Local Session 的 pre-session **Worktree** 开关与确认弹窗：确认前零副作用，确认后才创建 target、迁移未发送的文字/图片并打开独立 Session。
- Harness 官方 Slot 集成：
  - Create/Ready ToolView；
  - Header Session Target 状态胶囊；
  - `conversation.input.dock` 的 Ready、Preview 与 Recovery 状态条。
- Domi 式交付生命周期：
  - Ready for Review；
  - 不提交、可撤回的 Local Preview；
  - Preview 验收提交；
  - 撤回并恢复 Worktree 编辑；
  - 跳过验收直接提交；
  - cleanup 与 retain 策略。
- 项目级单 Preview 验收槽位、持久 Preview receipt、内部 Git refs、crash reconcile 与 cleanup retry。
- 13 个 strict Typert Remote 方法，覆盖 current/list/create/inspect、preflight、Preview/rollback/finalize、Discard、retention 与 cleanup。
- sibling managed Worktree 路径与安全 fallback；短 checkout identity 冲突时自动扩展，旧 registry 路径继续可管理。
- 一键本地 DSH 开发、临时 tarball 安装、profile smoke 与发布产物门禁。

### Safety

- Preview receipt 在触碰 Local 前持久化，并绑定 review、revision、isolated HEAD/fingerprint 和 Local HEAD/ref/fingerprint CAS。
- Local staged、unstaged、untracked 状态在 Preview、rollback 和 finalize 中保持分层语义；无法证明无损时 fail closed。
- 同分支 fast-forward 后的安全 rollback 使用三方反向合并，只移除 Preview delta，同时保留新 Commit 和 Preview 外 Local 修改。
- branch switch、non-fast-forward、重叠冲突、Preview 已进入 Commit、额外 Preview 修改或最终 CAS 漂移会进入 detached/recovery 状态，不覆盖用户修改。
- active Preview 的 Discard 必须先成功 rollback；detached Preview 保留 Worktree、receipt 与内部 refs 作为恢复证据。
- target Workspace cwd 必须 canonicalize 到 Host 记录的 managed root；caller/project/workspace/owner/review identity 全部 fail closed。
- owner Session live 后，source Session 不再拥有管理权限；其他 Session 不能依赖持久化 owner ID 越权管理。

### Changed

- Ready 主操作改为“同步到 Local 验收”；Preview 主操作改为“验收通过并提交”，撤回和 direct finish 收入“更多”菜单。
- 普通验收界面改为中文优先的紧凑摘要，验证详情默认折叠，不显示 Diff/Inspect 或平铺 Retention。
- 历史不可逆 `worktree_apply` 公开路径暂停；模型不再直接拥有 Finish、Discard 或 Remove 权限。
- `WorktreeConsoleView`、Host 控制面和 strict Remote 管理能力继续保留，但可见的项目级 `conversation.view` Worktree 页签暂不挂载，优先稳定 pre-session、独立 target Session 与 composer 验收主流程。
- managed Worktree 新路径采用 `<repo>--worktrees/<repo>--<checkout-short>--worktree`，不安全时回退到插件 stateDir。

### Compatibility

- 需要 DeepSeek Harness `0.1.0-rc.6` 包线与 Node.js 20 或更高版本。
- pnpm 10 的 Git 源安装可能需要在 profile `pnpm-workspace.yaml` 中允许 `dsh-git-worktree` 执行 `prepare`。
- `./manager` 不再是发布 export；Client/Host 集成改用正式 package entry、`./client`、strict `./typert` / `./remote` 与 `./console-contract`。
- 已经使用旧不可逆 Apply 的历史记录不会自动迁移到 Preview 生命周期，Finish/Discard 会保守拒绝并要求人工检查 Local。

## [0.1.2] - 2026-07-28

- 发布初版 Domi-grade Worktree 管理、基础 apply/finish/discard 生命周期和安全清理。

[0.2.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/wloops/dsh-git-worktree/releases/tag/v0.1.2
