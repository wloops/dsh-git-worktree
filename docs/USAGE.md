# dsh-git-worktree 使用指南

本指南说明日常操作、恢复场景、命令和常见问题。底层状态机、CAS 与权限不变量见 [Worktree Console 架构](WORKTREE-CONSOLE-ARCHITECTURE.md)。

[返回 README](../README.md) · [English](USAGE.en.md)

## 用户流程

```mermaid
stateDiagram-v2
    [*] --> Local: 打开 Git Workspace
    Local --> Working: 创建 Worktree Session
    Working --> Ready: Agent 完成并提交验收结果
    Ready --> Working: 保存阶段并继续
    Ready --> Preview: 预览修改
    Ready --> Delivered: 跳过预览并保存
    Ready --> Discarded: 放弃任务
    Preview --> Working: 撤回本次预览
    Preview --> Working: 保存阶段并继续
    Preview --> Delivered: 确认并保存
    Preview --> Recovery: Local 或 Preview 发生变化
    Recovery --> Working: 安全撤回或交接
    Recovery --> Delivered: 保存修改
    Delivered --> Retained: 保留运行环境
    Delivered --> Next: cleanup
    Retained --> Next: 清理环境
    Next --> Working: 开始下一轮
    Discarded --> [*]
```

## 创建 Worktree Session

### 新 Session

1. 打开 Git Workspace。
2. 创建 blank/new Session。
3. 启用 **Worktree**。
4. 输入任务并确认。

确认前不会创建 Worktree。确认后，草稿会迁移到新的隔离 Session，Local Session 不会被偷偷切换 cwd。迁移成功后，空白 source launcher 会自动归档，避免“新会话”复用它并阻塞下一项并发任务；owner Worktree Session 仍保留在对应 Workspace 中。

### 已有 Local Session

模型可以调用 `worktree_create` 创建新的 owner Session。返回卡片后打开目标 Session，再让 Agent 修改代码。

## Ready for Review

Agent 完成实现和验证后调用 `worktree_ready_for_review`，保存：

- 变更摘要；
- changed files；
- 验证状态和测试命令；
- 建议 Commit Message。

Ready 不写入 Local，也不创建 Commit。Review 卡会自动执行只读 Preflight。

### Ready 操作

| 操作 | 结果 |
| --- | --- |
| **预览修改** | 把任务增量写入 Local，保持未提交且可撤回 |
| **保存阶段并继续** | 在 managed Worktree 内创建 Checkpoint，Local 不更新 |
| **继续修改** | 使旧 Review 失效并返回当前 iteration 的 Working |
| **跳过预览并保存** | 经确认后直接保存本轮增量 |
| **放弃任务** | 在安全检查通过后清理 Worktree |

普通讨论不会使 Ready 失效；新的代码或文件修改会先恢复 Working。

## Local Preview

点击 **预览修改** 后，本轮任务增量会进入 Local working tree，但尚未创建用户 Commit。

### Preview 操作

| 操作 | 结果 |
| --- | --- |
| **确认并保存** | 只保存当前 Preview 对应的任务增量 |
| **撤回本次预览** | 移除 Preview，返回 Worktree 继续修改 |
| **保存阶段并继续** | 先安全撤回 Preview，再保存 Checkpoint |
| **放弃任务** | 尝试安全收口 Preview 并清理 Worktree |

Local 中与任务可分离的 staged、unstaged、untracked 修改会保留。若任务增量与这些修改重叠，操作会停止而不是覆盖。

## Checkpoint

**保存阶段并继续**适合长任务：

- 阶段 Commit 只存在于 managed Worktree；
- Local branch、index 和 working tree 不参与；
- 保存后 Worktree 回到 clean Working；
- 后续可以继续生成新的 Ready；
- 最终 Local 仍只得到一个累计任务 Commit。

当前仅支持线性阶段摘要，不支持编辑、删除、重排或任意回退历史 Checkpoint。

## Detached Preview 恢复

如果 Preview 后 Local branch/HEAD、index 或 working tree 继续变化，交付可能进入 `preview_detached`。界面会先执行只读 Recovery Preflight，再显示当前可证明安全的操作。

可能出现：

- **重新尝试撤回**：移除 Preview，同时保留后续可分离的 Local 修改；
- **保存修改**：把任务增量应用到当前可验证的 Local HEAD 并保存；
- **让 Agent 只读分析**：分析现场，不修改旧 Worktree 或 Local；
- **交接到新 Worktree**：从最新 Local HEAD 创建新环境继续恢复。

无法证明安全时，插件保留 receipt、journal 和恢复证据，不自动重试写入。

## 常见状态

| 状态 | 含义 | 建议操作 |
| --- | --- | --- |
| `stale_local` | Local 在检查后变化 | 刷新并重新 Preflight |
| `stale_isolated` | Worktree 在 Ready 后变化 | 重新检查或重新生成验收结果 |
| conflict | Local 与任务增量重叠 | 让 Agent 在原 Worktree 中解决冲突 |
| `project_acceptance_busy` | 其他任务正在预览同一 Local 项目 | 查看占用任务，等待其提交或撤回 |
| `preview_detached` | Preview 与当前 Local 状态分离 | 使用 Recovery Preflight 提供的操作 |
| `recovery_required` | 写入或清理结果无法完整证明 | 保留现场，按界面提示恢复 |
| `cleanup_pending` | 已交付，但 Worktree 清理未完成 | 重试清理环境 |
| `retained` | 已交付并保留运行环境 | 调整保留期限或手动清理 |

## 模型工具

| 工具 | 作用 |
| --- | --- |
| `worktree_create` | 从 Local Session 创建 managed Worktree 和独立 target Session |
| `worktree_list` | 列出当前 Session 可见的关联 Worktrees |
| `worktree_resume_revision` | 使旧 Review 失效并恢复当前 iteration |
| `worktree_begin_next_iteration` | 为已交付且 cleanup 完成的 Session 重建 Worktree cwd |
| `worktree_ready_for_review` | 保存交付报告并等待用户验收 |

Preview、Finalize、Discard 和 Remove 不属于普通模型工具，由用户界面或 Host 命令控制。

## `/worktree` 命令

```text
/worktree status
/worktree list
/worktree continue
/worktree next
/worktree finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <commit message>
/worktree discard
/worktree remove <checkoutId>
```

- `finalize` 使用当前 Review 的建议 Commit Message；
- `finish` 使用用户提供的 Commit Message；
- 日常操作优先使用 Web UI，命令适合诊断或无 UI 场景。

## 安装与排错

### npm 安装

```bash
dsh plugin --profile web add dsh-git-worktree
```

### Git tag 安装

```bash
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.6.0
```

pnpm 10+ 如果阻止 Git dependency 执行 `prepare`，在 profile 的 `pnpm-workspace.yaml` 中加入：

```yaml
allowBuilds:
  dsh-git-worktree: true
```

然后重新安装插件。

### 界面未出现

检查：

1. 当前 profile 是否为 `web`；
2. Workspace 是否为 Git 仓库；
3. 插件是否出现在 `dsh plugin --profile web list`；
4. 安装后是否重启 Harness；
5. 浏览器 bundle 是否加载当前插件版本。

### Worktree 无法创建

常见原因包括项目根不可访问、Git 命令失败、目标目录存在未知内容，或 Session/Workspace 身份不匹配。插件不会自动删除无法确认归属的目录。

### 无法预览修改

先查看 Preflight 提示：可能是冲突、Review 已过期、验收槽位占用、Local 分支变化或 Worktree 内容已变化。刷新状态后按界面提供的下一步处理。

## 完整交付示例

1. 创建 Worktree Session：

   ![创建 Worktree Session](screenshots/01-create-worktree.png)

2. Agent 生成 Ready for Review：

   ![Ready for Review](screenshots/02-ready-for-review.png)

3. 预览修改：

   ![Local Preview](screenshots/03-local-preview.png)

4. 确认并保存，选择 cleanup 或保留环境：

   ![保存确认](screenshots/04-commit-confirmation.png)

5. 在同一 Session 开始下一轮：

   ![开始下一轮](screenshots/05-next-iteration.png)

6. 保留运行环境：

   ![保留环境](screenshots/06-retain-environment.png)

## 本地开发

标准检查：

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run check:publish
```

端到端运行：

```bash
pnpm run dev:dsh
```

常用变体：

```bash
pnpm run dev:dsh:install
pnpm run dev:dsh:smoke
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web
pnpm run dev:dsh:remove
```

`dev:dsh` 只构建和安装当前 checkout，不会发布 npm 包或 push Git refs。

## 进一步阅读

- [README](../README.md)
- [Worktree Console 架构](WORKTREE-CONSOLE-ARCHITECTURE.md)
- [Session Target 迁移说明](PORTING.md)
- [UI 开发说明](UI-DEVELOPMENT.md)
- [发布清单](RELEASE.md)
- [变更记录](../CHANGELOG.md)
