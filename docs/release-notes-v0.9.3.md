# v0.9.3 发布说明（候选；发布门禁尚未通过）

本版修复插件在新旧 Harness 协议间的 Remote codec、会话导航与受管侧栏兼容问题，并让隔离源码开发安装和预会话草稿迁移可正确完成。**当前尚不能用于正式 tag / GitHub Release：完整测试未通过，须先解决并重新核验以下阻塞项。**

## 主要更新

- strict Remote codec 同时适配旧 `schema` 与新 `create()`，会话导航按 Host 能力选用 `uiWorkspace.openSession` 或旧 `sessions.open`；归属歧义时拒绝危险操作。
- 从三版精确版本/SHA-256 校验的官方 Workspace Browser 派生中，按 Host 实际 `dsh-agent` 版本选择一个；未知版本不覆盖官方 Workspace。受管行保留安全操作与状态标记。
- 在预会话草稿交接和导航期间通过 `sessions.using()` 持有目标 Session 引用；隔离开发安装修复源码 CLI、空 Profile、pnpm 选择以及默认 Workspace/缓存污染。

## 兼容与迁移

`0.1.2-rc.1` 仍为构建与多数开发依赖基线；locale peer 精确接受 `0.1.2-rc.1 || 0.1.7-rc.2`，其他 DSH peer 范围未扩大。`0.1.7-rc.2` 仅在隔离源码 Host/Profile 验证安装、Web 渲染、Worktree 开关、预会话创建/草稿迁移和侧栏状态；未配置 API Key，AI 对话及 Review/恢复/清理尚未验收。`0.1.6-alpha.2`、`0.1.5-rc.3` 未完成隔离 Profile 联调，不声明完整运行时兼容。无 Worktree registry/Review/Recovery 数据迁移；升级新 Host 前备份 Session 数据并隔离测试。详见 [兼容性说明](COMPATIBILITY.md)。

## 验证状态（2026-09-25；待补全）

`pnpm run typecheck`、`pnpm run check:sidebar-version`、`pnpm run build`、`pnpm run check:publish` 和 `pnpm pack --dry-run` 已通过。`pnpm test` **未通过**（40 个测试文件中 7 个失败、33 个通过；550 项中 31 失败、518 通过、1 跳过）：失败覆盖 Client Host generation/locale、Worktree 创建路径与超时清理等。当前检查在受管隔离 Worktree 中进行，尚不能把这些失败归因于运行环境，也不能宣布发布门禁通过。正式发布还须在验收提交后的 clean Local 运行 `check:publish:release`、推送精确 release commit 并等待 CI 成功，再创建 annotated tag 与 GitHub Release，并完成真实安装 smoke。

**npm 状态：尚未发布 `0.9.3`；不得在上述阻塞解除前打 tag 或发布。**
