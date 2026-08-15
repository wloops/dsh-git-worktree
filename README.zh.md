# dsh-git-worktree

为 DeepSeek Harness 打造的 Domi 级 git worktree 隔离与交付插件：永久 worktree、ready-for-review / apply / finish / discard 完整生命周期、冲突处理与安全清理。

> 移植自 [Domi](https://github.com/wloops/domi) 的生产 worktree 系统（Session Target / Isolated Checkout），为适配 DSH 沙箱模型移除了 Local Preview 面。

## 能力

| 能力 | 说明 |
| --- | --- |
| `worktree_create` / `worktree_list` / `worktree_remove` | 仓库内 `.dsh-worktrees/` 下的永久 detached worktree，manifest 记录 + 注册为 DSH 工作区 |
| `worktree_ready_for_review` | Agent 提交验收信息（摘要、验证项、建议提交信息） |
| `worktree_apply` | 确定性合并 worktree 改动回 Local checkout——冲突感知、指纹 CAS、plan 验证前绝不触碰 Local |
| `worktree_finish` | 把任务增量提交到 Local 分支，同时保留你自己的 staged/working 状态 |
| `worktree_discard` | 丢弃 worktree（dirty 需要显式确认） |
| `/worktree` | 人类可用的命令入口 |
| 安全清理 | 保留期到期自动清理、残余 quarantine、dirty 永不静默删除、不执行全局 `git worktree prune` |

## 为什么 worktree 放在仓库内

DSH 的 `workspace-write` 沙箱只授予会话工作区根。因此 worktree 位于 `<repo>/.dsh-worktrees/<name>`（与 Codex 的 `.codex/worktrees` 同模式），agent 的文件工具和 git 操作都留在沙箱内。

## 安装

```sh
dsh plugin --profile web add dsh-git-worktree
# 或从 GitHub
dsh plugin --profile web add github:wloops/dsh-git-worktree#<tag>
```

## 状态

预发布（`0.1.0`）。状态机与 apply 引擎移植自 Domi 生产代码（journal 崩溃恢复、指纹 CAS、Windows 清理重试）；DSH 工具面为新增并正在加固。要求 DSH `0.1.0-rc.6` 线（`@deepseek-ai/dsh-tools` / `dsh-subprocess` / `dsh-commands`）。

## 许可证

MIT
