# dsh-git-worktree

[![npm](https://img.shields.io/npm/v/dsh-git-worktree)](https://www.npmjs.com/package/dsh-git-worktree)
[![CI](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml/badge.svg)](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**让 Agent 在真实 Git Worktree 中完成任务，在 Local 中验收，并且只在用户明确确认后提交。**

`dsh-git-worktree` 是一个实验性的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 插件。它把 Git Worktree 变成独立的 Session Target：Agent 使用单独的 checkout 和 Session 工作，原始 Local 工作区始终由用户控制。

[English](README.md)

## 为什么需要它？

普通 Agent Session 可能直接修改你正在使用的工作区。本插件把“执行任务”和“接受结果”分开：

- **真实隔离**：每个任务都有独立的 Git Worktree、Workspace、cwd 和 Session ID。
- **用户掌握交付权**：模型可以准备验收报告，但不能自行提交、放弃或清理。
- **可撤回的 Local Preview**：提交前先在 Local 查看精确变更，可以验收提交，也可以撤回后继续修改。
- **保留 Local 现场**：Local 中已有的 staged、unstaged 和 untracked 内容不会被混入任务提交。
- **保守恢复**：历史验收卡、并发修改、分支变化或清理身份不确定时直接停止，不覆盖用户数据。

> 项目仍处于实验阶段。当前提供的是项目级 Worktree Session 工作流，还不是跨项目的全局 Worktree Manager。

## 工作流程

```text
Local Session
    │
    ├─ 创建隔离的 Worktree Session
    ▼
Agent 在 Worktree 中修改并验证
    │
    ├─ worktree_ready_for_review
    ▼
等待验收
    │
    ├─ 同步到 Local Preview ── 验收并提交
    │                         └─ 撤回并继续修改
    ├─ 跳过 Preview，直接提交
    └─ 放弃任务
    │
    └─ cleanup 后在原 Session 开始 iteration + 1
```

1. 在 blank/new Local Session 中打开 **Worktree** 开关并确认。未发送的文字和图片草稿会迁移到隔离 Session；取消不会创建任何资源。
2. 已存在的 Local Session 可以由模型调用 `worktree_create`，然后由用户从 ToolView 打开隔离 Session。
3. Agent 只在隔离 cwd 中修改和验证代码。
4. Agent 最后调用 `worktree_ready_for_review`，写入变更摘要、验证证据和建议 Commit Message，然后停止。
5. 用户决定如何处理：
   - **同步到 Local 验收**，再提交或撤回 Preview；
   - **跳过验收，直接提交**；
   - **放弃任务**。
6. 成功提交并 cleanup 后，可以在原隔离 Session 中开始下一轮，不丢失现有对话。Harness 的 Session cwd 不可变，因此插件只会在严格身份校验后重建上一轮已经清理的 Host-owned managed path。

所有验收路径在写入前都会重新校验 review revision、Worktree HEAD/fingerprint 和 Local 状态。Retained 或 cleanup-pending 环境必须先完成清理；开始下一轮不会静默删除这些环境。

## 环境要求

- Node.js 20 或更高版本
- DeepSeek Harness `0.1.0-rc.6` 包线
- 使用 Harness Web Client 才能获得完整交互界面
- 当前 Workspace 必须是 Git 仓库

## 安装

```bash
# npm 包
dsh plugin --profile web add dsh-git-worktree

# Git tag；prepare 会构建 Host 和 Client bundle
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.2.0
```

使用 pnpm 10 或更高版本时，Git 源安装可能需要先在 profile 的 `pnpm-workspace.yaml` 中加入：

```yaml
allowBuilds:
  dsh-git-worktree: true
```

安装后正常启动 Harness，并以一个 Git 仓库作为 Workspace。

## 用户与模型入口

### 模型工具

| 工具 | 作用 |
| --- | --- |
| `worktree_create` | 创建 managed Worktree 并预留独立 target Session，不修改当前 Session cwd |
| `worktree_list` | 列出当前 Session 在原始项目中可见的 Worktree |
| `worktree_begin_next_iteration` | 为已成功清理的 delivered Session 重建 iteration + 1，并保持同一 Session 与完整对话 |
| `worktree_ready_for_review` | 保存交付报告并停止，等待用户明确验收 |

Finish、Discard、Remove 不向模型开放，避免用模型参数代替用户授权。

### 用户操作

Web UI 提供创建、Preview、撤回、提交、保留和放弃等常用操作。Host 控制的同类能力也可以通过 `/worktree` 命令调用：

```text
/worktree status
/worktree list
/worktree next
/worktree finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <Commit Message>
/worktree discard
/worktree remove <checkoutId>
```

`finalize` 使用当前验收报告中的建议 Commit Message；`finish` 是由用户提供自定义消息的直接提交路径。

## 安全模型

实现把 Domi 中经过生产验证的 checkout/apply 安全基础迁移到 Harness 的权威 Workspace / Session cwd 模型。关键不变量包括：

- 初始 Local source 与 isolated target 使用不同的 Session ID；后续 iteration 保持同一个 isolated Session ID。
- 活动 target 的 Harness Workspace 必须解析到 Host 记录的 managed root。已清理的 delivered target 只在 Host Workspace 原始路径与 predecessor 记录精确一致时，才允许暂时引用缺失的 immutable cwd。
- 同一 canonical Local 项目同时只允许一个活动 Preview。
- 在写入 Local 前先持久化 Preview receipt，使 Host 重启后仍可恢复 rollback/finalize。
- Preview、Commit 和 rollback 路径都使用 revision、HEAD 与 fingerprint compare-and-swap 校验；基于验收报告的路径还会绑定 review ID。
- 清理前验证路径身份、Git 元数据和最终 fingerprint；无法确认的残余会保留或 quarantine。
- 下一轮只复用已成功清理且当前不存在的 predecessor path，创建新的 checkout record，并保留上一轮记录作为恢复证据。
- 旧版不可逆 Apply 流程产生的历史记录不会被自动 Finish 或 Discard。

详细边界与恢复设计见 [Domi 到 Harness 的迁移说明](docs/PORTING.md) 和 [Worktree Console 架构](docs/WORKTREE-CONSOLE-ARCHITECTURE.md)。

## 本地开发

安装依赖并运行标准检查：

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run check:publish
```

端到端启动本地 Harness：

```bash
pnpm run dev:dsh
```

该命令会构建当前 checkout，将其打成临时本地 tarball，安装到 `web` profile，验证组合配置，准备受 marker 保护的临时 Git fixture，并默认在 `http://127.0.0.1:3081` 启动 `dsh web`。它不会发布 npm 包，也不会 push Git refs。

常用变体：

```bash
# 只安装并验证当前快照，不启动 Web
pnpm run dev:dsh:install

# 验证已经安装的 profile
pnpm run dev:dsh:smoke

# 使用现有 Git 根目录、其他端口或其他 profile
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web

# 移除开发安装和缓存的本地归档
pnpm run dev:dsh:remove
```

如果发现附近的 DeepSeek Harness 源码 checkout，`dev:dsh` 会优先选择已经安装 `node_modules/tsx`、可直接运行的候选；源码位于任意其他目录时，可以通过 `DSH_HARNESS_ROOT` 或 `--harness <path>` 指定。选择源码 checkout 后，插件安装、配置验证、移除和 Web 启动都会使用该源码 CLI，不再要求全局安装 `dsh`；显式指定的 checkout 尚未安装依赖时，脚本会在构建前提示对应的 `pnpm --dir <path> install` 命令。只有未选择源码 checkout 时才回退到 PATH 中的 `dsh`。

## 当前限制

- 暂无跨项目全局侧栏 Manager。
- 项目级 Worktree Console 实现仍保留，但 `v0.2.0` 暂不挂载可见的 `conversation.view` 标签页，当前优先稳定主流程。
- 在已验证的 Harness `0.1.0-rc.6` 包线中，Workflow `agent({ isolation })` 集成尚不可用。
- 在该 Harness 包线中，子 Agent 继承父 Session cwd；只有父 Session 已经是 Worktree Session 时才处于隔离环境。
- dependency snapshot/restore 和完整 collaborator handoff UI 尚未实现。
- 选择立即清理后，隔离 cwd 会被删除，该 Session 随即进入终态；后续应回到 Local 或开始新一轮任务。

## 文档

- [Domi 到 Harness 的迁移说明](docs/PORTING.md)
- [Worktree Console 架构](docs/WORKTREE-CONSOLE-ARCHITECTURE.md)
- [UI 开发说明](docs/UI-DEVELOPMENT.md)
- [发布清单](docs/RELEASE.md)
- [变更记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
