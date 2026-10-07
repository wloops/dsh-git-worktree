# v0.10.1 发布说明（候选；待 clean Local 和 CI 验收）

本版恢复托管会话被过度屏蔽的官方侧边栏操作，收敛受管会话行内状态展示，并让验收详情的长列表默认折叠；是无数据迁移的补丁版。

## 主要更新

- 恢复托管会话行的官方重命名、归档与归档恢复：`pin`、`rename`、`archive` 在 alpha、next、modern 三版 Workspace Client 派生中保持原生菜单与回调，guard 改为保存在 `uiWorkspace` 实例上，避免 Cordis Context 派生丢失引用；Fork 等可能破坏托管归属的操作继续被阻止，安全操作不再依赖拓扑加载完成。
- 托管会话处于 working 状态时仅隐藏行内 Worktree 文字标签；Worktree 图标、官方运行指示器、完整悬停状态及其他状态标签保留。
- 验收详情的修改文件与验证记录超过 5 项时默认折叠为前 5 项，可独立展开全部/收起；重新打开详情或切换验收（checkout/review/revision）时重置折叠状态，附中英文文案与无障碍属性。

## 兼容与迁移

无 Worktree registry、Review 或 Recovery 数据迁移。peer 仍精确锁定 DSH `0.2.0-rc.2`：`0.2.x` Host 使用本版，`0.1.x` Host 继续使用 `0.9.x` 插件线，其兼容记录见 [兼容性说明](COMPATIBILITY.md)。刚发布的版本可能被 Profile 的 `minimumReleaseAge` 供应链防护静默回退到旧版，安装时请显式指定 `dsh-git-worktree@0.10.1`。

## 验证状态（2026-10-07；发布前需 clean Local 和 CI）

在受管隔离 Worktree 中，`pnpm run typecheck`、`pnpm test`（42 个测试文件全通过；592 项通过、1 项跳过）、`pnpm run check:sidebar-version`、`pnpm run build`、`pnpm run check:publish` 和 `pnpm pack --dry-run` 已通过。正式发布仍须在验收提交后的 clean Local 重跑发布门禁、推送精确 release commit 并等待 CI 成功，再创建 annotated tag 与 GitHub Release，并完成真实安装 smoke。

**npm 状态：尚未发布 `0.10.1`；clean Local 和 CI 验收前不得打 tag 或发布。**
