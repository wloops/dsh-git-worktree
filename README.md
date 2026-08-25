# dsh-git-worktree

[![npm](https://img.shields.io/npm/v/dsh-git-worktree)](https://www.npmjs.com/package/dsh-git-worktree)
[![CI](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml/badge.svg)](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**让 Agent 在真实 Git Worktree 中执行任务，把结果同步到 Local 验收，并且只在用户明确确认后提交。**

`dsh-git-worktree` 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的实验性 Session Target 插件。每个编码任务都在独立 checkout 和独立 Session 中运行，用户正在使用的 Local 工作区不会直接变成 Agent 的施工现场。

本项目是独立社区插件，并非 DeepSeek 官方项目，也不代表官方背书、合作或授权。

它不是一个简单的 `git worktree` 命令包装器，而是一套完整的任务交付流程：创建隔离环境、持续修改、生成验收报告、可撤回地同步到 Local、确认后创建单个提交，以及失败时保留恢复证据。

> Worktree 安全基础源自作者内部桌面项目 **Domi** 的实际工作流；本插件已针对 Harness 独立适配，安装和使用均不依赖 Domi。

[English](README.en.md)

## 它解决什么问题？

普通 Agent Session 直接修改当前工作区时，用户容易遇到几个问题：

- Agent 的修改与 Local 中已有的 staged、unstaged、untracked 内容混在一起；
- 多个 Agent 任务共用一个 checkout 时，会相互覆盖文件、切换分支或污染彼此的提交边界；
- 多个任务同时把结果写入 Local 时，Preview、冲突处理和清理操作容易互相干扰；
- 任务完成前，用户很难确认哪些修改属于本次任务；
- “查看结果”常常已经等于“写入 Local”，不容易安全撤回；
- 提交、清理或恢复操作如果依赖模型自行判断，会放大误操作风险；
- 长对话完成一轮后，开始下一轮通常需要换 Session、重新解释上下文。

本插件把一次编码任务分成两个边界清晰的阶段：

1. **Agent 在 Isolated Worktree 中施工和验证**；
2. **用户在 Local 中验收并决定是否提交**。

## 核心能力

- **真实隔离**：每个任务拥有独立的 Git Worktree、Harness Workspace、cwd 和 Session ID。
- **用户掌握交付权**：模型可以准备验收报告，但不能自行 Preview、Commit、Discard 或删除 Worktree。
- **可撤回的 Local Preview**：先把任务增量同步到 Local 查看，不创建 Commit；不满意时可以只撤回这次 Preview。
- **保留 Local 现场**：Local 原有的 staged、unstaged 和 untracked 内容不会被自动混入任务提交。
- **并行施工、有序验收**：多个 Isolated Worktree 可以并行准备任务，但同一 Local 项目同时只允许一个 active Preview，避免多个验收稿交叉写入。
- **冲突时停止而非覆盖**：重叠修改、Local 漂移、分支变化或无法安全拆分的增量会进入 conflict/recovery，不自动选择一方覆盖。
- **单任务提交**：验收通过后，只为本次任务创建一个 Commit，并继续保留可分离的 Local 修改。
- **保存阶段并继续**：Ready 或 active Preview 可以由用户显式保存为 managed Worktree 内部 Checkpoint；阶段 Commit 不进入 Local，工作区清理后继续开发，最终仍只向 Local 交付一个累计任务 Commit。
- **同一 Session 连续迭代**：本轮成功交付并 cleanup 后，可在原 Session 中开始 iteration + 1，保留完整对话。
- **自动只读 Preflight**：Ready 后由 Review 卡与 composer dock 自动展示 Local/Worktree HEAD、effective base、同步条件、冲突与 acceptance slot；自动阶段绝不写入 Local。
- **Agent Recovery continuation**：冲突只在用户明确点击后恢复 Working，并通过 Harness 官方 Session API 把 Local HEAD 与冲突文件交给精确 owner Agent；`stale_isolated` 则保持严格只读，只重新验证并生成新验收稿。
- **Host 权威 Detached Preview 恢复**：Preview 因 Local 漂移进入 `preview_detached` 后，Host 会只读核验 receipt、retained refs、HEAD/ref、index、working tree 与验收槽位；只有新鲜 proof 明确标记安全时才显示撤回或提交，也可让 Agent 只读分析，或从最新 Local HEAD 交接到全新 Worktree。
- **可核验 Delivery Proof**：Finalize 后展示 Commit OID、Local branch/HEAD、文件与验证摘要，以及 cleanup/retention 结果。
- **保守恢复**：Review 过期、Local 漂移、分支变化、并发 Preview 或清理身份不确定时停止写入，不覆盖用户数据。

> 当前定位是“项目级 Worktree Session 工作流”，不是跨项目全局 Worktree Manager。项目仍处于实验阶段，建议先在可恢复的 Git 仓库中使用。

### 多任务与冲突边界

多个任务可以各自在独立 Worktree、Workspace 和 Session 中并行修改、测试与准备 Review，不需要共享同一个 checkout。进入 Local 验收时则刻意串行化：同一 canonical Local 项目只有一个 acceptance slot，已有 Preview 未提交或撤回前，其他任务会收到 `project_acceptance_busy`，而不是继续叠加写入。

插件不会把“支持并行任务”解释成“自动合并所有冲突”。如果任务增量与 Local 修改重叠、Review 已过期、分支发生非快进变化，或 Host 无法证明 Rollback/Finalize 能保留其他修改，操作会停止并保留恢复证据，交给用户决定下一步。

## 工作流程

```text
Local Session
    │
    ├─ 创建隔离的 Worktree Session
    ▼
Agent 在 Worktree 中修改、测试
    │
    ├─ worktree_ready_for_review
    ▼
Ready for Review
    │
    ├─ 保存阶段并继续 ── Worktree 内部 Checkpoint
    ├─ 同步到 Local Preview ── 验收并提交
    │                         ├─ 撤回 Preview，继续修改
    │                         └─ 撤回 Preview，保存阶段并继续
    ├─ 跳过 Preview，直接提交
    └─ 放弃任务
    │
    └─ cleanup 后在原 Session 开始 iteration + 1
```

### 1. 创建隔离 Session

在 blank/new Local Session 中打开 **Worktree** 开关并确认。确认之前不会创建 Worktree；确认后，未发送的文字和图片草稿会迁移到新的隔离 Session。

已有 Local Session 也可以由模型调用 `worktree_create` 创建目标 Session。源 Session 始终保持 Local，不会被偷偷切换到另一个 cwd。

### 2. Agent 在 Worktree 中工作

Agent 只在隔离 cwd 中读取、修改和验证项目。该 cwd 对应真实 Git Worktree，同时注册为 Harness Workspace，因此 Harness 的 Workspace 和 Session 边界仍然有效。

### 3. 准备验收

实现和验证完成后，Agent 调用 `worktree_ready_for_review`，提交：

- 变更摘要；
- changed files；
- 验证状态与测试命令；
- 建议 Commit Message。

该操作只保存验收报告，不写入 Local，也不创建 Commit。Ready 出现后，专用 Review 卡和 composer dock 会自动执行严格只读 Preflight，展示 Local/Worktree HEAD、effective base、变更数量、冲突和 acceptance slot；Review 卡与 dock 会复用同一检查结果，但真正 Preview 或直接 Finalize 前仍会强制重新检查，不能把缓存当作写入授权。

### 4. 用户决定如何交付

用户可以选择：

- **保存阶段并继续**：把当前验收快照提交到 managed Worktree，清空当前施工现场并恢复 Working；
- **同步到 Local 验收**：创建一个未提交、可撤回的 Preview；
- **验收通过并提交**：只提交本次任务累计增量；
- **撤回并继续修改**：移除 Preview，返回原 Worktree；
- **跳过验收直接提交**：显式确认后走受保护的直接交付路径；
- **放弃任务**：在满足安全条件后清理任务环境。

Checkpoint 只允许精确 owner 在当前 Review、revision、generation 和 acceptance slot 均匹配时显式执行。Host 在锁内创建 Worktree-only Commit、持久化 operation journal 与内部 artifact、执行写后验证，并让旧 Review/Preview/proof 失效；相同 request ID 的完成请求可安全重放。active Preview 会在同一个 Host 操作中先安全撤回，撤回无法证明时保留恢复证据并停止。Local branch/HEAD、index、staged、unstaged、untracked 与 working tree 不参与 Checkpoint Commit；多次 Checkpoint 也不会把最终 Local 交付拆成多个提交。

如果预检发现 `stale_local`、`stale_isolated` 或冲突，旧 Preview/Finalize 操作会立即停用。`stale_local` 只刷新只读事实；冲突仅在用户点击“让 Agent 解决冲突”后，才由 Host 在锁内重跑 conflict Preflight/CAS、生成并持久化精确恢复凭证、恢复 Working，再通过 Harness 官方 `ISession.prompt()` 将结构化上下文发送给精确 owner Session；`stale_isolated` 的“重新生成验收结果”保持 Ready 与严格 Read Only，由 Host 只读复核并持久化另一种不可互换的凭证，不恢复 Working 或修改文件。发送会等待 Session 加载完成并停止 streaming，并在真正发送前重新逐字段核验 Host proof、checkout/review/revision/cwd；重复点击单飞。未发送请求可在页面刷新后恢复，但浏览器存储只是不可信上下文，必须通过 kind、字段、OID、相对路径预算和 Host 权威复验；发送结果未知或明确失败时由用户显式重试。`project_acceptance_busy` 会显示不含路径的占用任务摘要；只有 Host 再次证明 checkout、owner Session 与 canonical cwd 一致后，界面才会导航到该 Session。Finalize 成功后，Review 界面继续保留 Delivery Proof，而不是只显示“成功”。

#### Detached Preview 恢复

当 Preview receipt 仍完整、但 Local branch/HEAD、index 或 working tree 已变化时，交付会进入 `preview_detached`。这里的 detached 是交付状态，不是 Git detached HEAD。Review 界面会自动运行严格只读的 Recovery Preflight，并展示 Host generation、当前 Local HEAD/ref，以及撤回和提交各自的结构化结论。

- Recovery proof 绑定精确 Session、checkout、revision、Review、Preview、receipt fingerprint、四个 retained artifacts、Local fingerprint/trees 和 acceptance-slot holder；proof 只是确定性复验上下文，不是 bearer permission。
- 点击安全撤回、提交、只读分析或新 Worktree 交接时，Client 都会绕过展示缓存再取一次 proof；Host 随后在 binding lock 内重新计算并逐项比较，任何 revision、Local、artifact 或 slot 变化都会在写入前拒绝。
- 同分支可证明 fast-forward 时，撤回只移除 Preview，提交只把任务 delta 放到最新 Local HEAD；后续 staged、unstaged、untracked 和新 Commit 会继续保留。切分支、non-fast-forward、Preview 已入历史、hunk 冲突或缺失 artifact 会 fail closed。
- “让 Agent 只读分析”不会修改旧 Worktree、Local、refs/index 或 artifacts；“交接到新 Worktree”从最新 Local HEAD 创建新的 managed checkout，失败时旧 detached delivery、receipt、retained refs、Local 和旧 Worktree 均保持不变。
- Git 写入后若无法精确证明 HEAD/ref/index/tree/fingerprint 已达到目标，状态进入 `recovery_required` 并保留 journal 与证据；不会把“看起来像成功”自动记为已完成，也不会自动重试写入。

### 5. 在原对话开始下一轮

成功提交并 cleanup 后，本轮 Worktree cwd 会被删除，但 Session 和对话仍然保留。用户提出新的代码或文件修改时，插件可以基于最新 Local HEAD，安全重建该 Session 的 immutable cwd，并进入下一轮 iteration。

Retained、cleanup-pending 或 recovery 状态不会被静默清理，必须先完成对应的人工处理。

## 界面预览

以下截图按一次完整任务的实际顺序展示主要交付流程。

### 创建 Worktree Session

在新的 Local Session 中启用 Worktree 后，Harness 会先说明会话切换边界；只有用户确认后才会创建并切换到隔离 Session。

![确认创建并切换到 Worktree Session](docs/screenshots/01-create-worktree.png)

### 准备验收

Agent 完成实现和验证后生成 Ready for Review，用户可以查看变更摘要与验证结果，再决定是否同步到 Local。

![Worktree 修改已准备验收](docs/screenshots/02-ready-for-review.png)

### 在 Local Preview 中验收

同步后，本次任务增量会以可撤回的 Local Preview 等待验收；用户可以提交、撤回后继续修改，或放弃任务。

![任务修改正在 Local Preview 中等待验收](docs/screenshots/03-local-preview.png)

### 确认提交与环境保留

默认路径会确认 Commit Message 并在提交后清理 Worktree；需要继续排查时，也可以按所选时长暂时保留冻结的运行环境。

| 提交并清理 | 提交并保留运行环境 |
| --- | --- |
| ![确认提交任务增量并清理 Worktree](docs/screenshots/04-commit-confirmation.png) | ![确认提交任务增量并保留运行环境](docs/screenshots/06-retain-environment.png) |

### 在同一 Session 开始下一轮

交付与 cleanup 成功后，原对话会保留，并可以基于最新 Local HEAD 开始下一轮修改。

![本轮已交付并可以开始下一轮修改](docs/screenshots/05-next-iteration.png)

## 术语说明

文档保留部分英文术语，以便与 Harness 界面、工具名和错误码对应；首次阅读时可以按下表理解：

| 术语 | 中文注解 | 在本项目中的含义 |
| --- | --- | --- |
| Session Target | 会话执行目标 | 当前 Session 被固定到的实际工作位置与执行边界，可以是 Local 或 Isolated Worktree |
| Isolated Worktree / checkout | 隔离 Worktree / checkout | Agent 独立施工的 Git 工作副本，不直接修改用户的 Local checkout |
| Review / Ready for Review | 验收稿 / 等待验收 | Agent 完成当前阶段后提交的摘要、文件、验证结果和建议 Commit Message |
| Checkpoint | 阶段检查点 | 用户确认后在 managed Worktree 内保存当前验收快照并继续开发，不写入 Local |
| Local Preview | Local 预览 | 将任务增量临时同步到 Local 查看，但暂不创建 Commit |
| Rollback / Finalize | 撤回预览 / 确认提交 | 分别表示安全移除本次 Preview，或将验收通过的任务增量提交到 Local |
| acceptance slot | 验收槽位 | 同一 Local 项目唯一的 Preview 写入名额，用于避免多个任务同时写入 Local |
| cleanup / retention | 清理 / 保留运行环境 | 交付后立即删除 Worktree，或按用户选择暂时保留冻结环境 |
| iteration | 任务轮次 | 同一 Session 中一次完整的创建、修改、验收与交付周期 |
| fail closed / recovery | 保守拒绝 / 恢复处理 | 无法证明安全时停止写入并保留证据，而不是自动猜测或覆盖 |

## 设计基础与 Harness 适配

本项目的 Worktree 生命周期与 Git 交付引擎基于一套经过实际使用验证的桌面端实现重新适配。重点不是复制原有界面，而是保留已经验证过的安全不变量：

- managed checkout registry 与 revision CAS；
- canonical path、Git common-dir 和 git-dir 身份校验；
- staged、unstaged、untracked、binary 和 deletion 状态的完整 fingerprint；
- receipt-first Local Preview、Rollback 与 Finalize；
- 只提交任务增量，同时保留 Local 其他修改；
- internal refs、journal recovery、retention、quarantine 和保守 cleanup；
- 无法证明安全时 fail closed，而不是猜测后继续写入。

DeepSeek Harness 与原桌面端宿主模型不同，因此本插件对产品和权限边界做了重新适配：

- Harness 的 Workspace 与 Session cwd 是权威身份，插件 registry 只作为辅助状态；
- Host 能力通过 strict Typert Remote 暴露，浏览器 UI 使用 Harness 的公开 Client Slots；
- Local source Session 与 Isolated target Session 始终分离；
- cleanup 后不修改 Harness 已持久化的 Session cwd，而是在下一轮严格校验后重建同一路径；
- 模型只负责创建、显式授权后的冲突修复、只读验收再生成和准备验收；最终写入 Local、提交与清理由用户入口控制。

详细的身份、状态与恢复边界见 [Session Target 迁移说明](docs/PORTING.md)。

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`；
- DeepSeek Harness `0.1.1-rc.2` 包线；
- Harness Web Client，用于完整的 Worktree 创建和验收界面；
- 当前 Workspace 是 Git 仓库。

## 安装

推荐直接安装 npm 包：

```bash
dsh plugin --profile web add dsh-git-worktree
```

也可以安装指定 Git tag：

```bash
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.6.0
```

使用 pnpm 10 或更高版本时，Git 源安装可能需要先在 profile 的 `pnpm-workspace.yaml` 中允许该包执行 `prepare`：

```yaml
allowBuilds:
  dsh-git-worktree: true
```

安装完成后正常启动 Harness，并打开一个 Git 仓库作为 Workspace。

## 模型工具与用户入口

### 模型工具

| 工具 | 作用 |
| --- | --- |
| `worktree_create` | 从 Local Session 创建 managed Worktree，并预留独立 target Session |
| `worktree_list` | 列出当前 Session 在原项目中可见的 Worktree |
| `worktree_resume_revision` | 使尚未同步的旧 Review 失效，在不触碰 Local 的情况下恢复当前 iteration |
| `worktree_begin_next_iteration` | 为已交付且 cleanup 完成的 Session 重建下一轮 Worktree cwd |
| `worktree_ready_for_review` | 保存交付报告并停止，等待用户验收 |

Finish、Discard、Remove 和 Local Preview 不属于模型工具。普通讨论不会让 Ready Review 失效；只有新的代码或文件修改才需要恢复 Working。

### 用户操作

Web UI 提供日常所需的创建、Preview、撤回、提交、保留、继续修改和放弃入口。Session Header 的 `Local / Worktree · 状态` 胶囊可直接打开当前目标控制面板与“关联 Worktrees”管理器；source 或任一关联 target Session 都能查看同源任务、打开对应 Session，并在自身权限范围内处理当前 Worktree，无需返回原项目。Manager 只承载状态、导航与 owner lifecycle 操作，不恢复检查或验收展开；自动 Preflight、stale/conflict 恢复、acceptance slot 导航和 Delivery Proof 继续由专用 Review 卡与 composer dock 承担。Host 控制的同类能力也可通过 `/worktree` 命令使用：

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

`finalize` 使用当前验收报告中的建议 Commit Message；`finish` 是用户提供自定义消息的显式直接提交路径。

## 安全模型

所有验收操作都由 Host 重新校验，不信任浏览器展示状态或模型输出中的身份信息。

关键规则包括：

- Local source 与 Isolated target 使用不同 Session ID；
- active target 的 Workspace 必须 canonicalize 到 registry 记录的 managed root；
- 同一 canonical Local 项目同时最多存在一个 active Preview；等待中的 owner 仍可执行只读 Preflight，但 Preview/Finalize capability 会关闭；
- acceptance slot blocker 只返回 path-free checkout/Session/state 摘要；打开占用任务前必须重新 inspect 并复验 owner 与 canonical cwd；
- 自动 Preflight 不创建 plan、slot、Git ref 或 Local 写入；Preview 与 direct Finalize 前必须 bypass 缓存重新检查；slot 从 waiting 释放时废弃旧 busy 结果，自动错误只允许显式重试；
- Preview receipt 和 internal refs 在写入 Local 前持久化；
- Checkpoint 绑定 exact owner、checkout、revision、review、generation、request ID 与 acceptance slot；Host 原子撤回 active Preview 后仅提交 managed Worktree snapshot，写后验证并使旧 Review/Preview/proof 失效，Remote 不暴露路径或内部 refs；
- `preview_detached` Recovery Preflight 严格只读，并在 assessment 前后复验四个 retained artifacts；Remote 只返回 path-free proof，不暴露 Local/Worktree 路径；
- Preview、Rollback、Finalize、Discard 和继续修改都绑定 checkout、revision、review 与 fingerprint；detached mutation 还必须携带新鲜 generation，Host 在锁内重算 proof 后才可进入 journal；
- Rollback 只移除可以证明属于本次 Preview 的增量，并尽量保留验收期间新增的无关 Local 修改；Finalize 只提交任务 delta 到最新同分支 Local HEAD；
- Local 第一次写入前执行最终 CAS，写入后精确验证 HEAD/ref/index/tree/fingerprint；不确定结果进入 `recovery_required` 并保留 journal，不能仅凭 Commit HEAD 猜测成功；
- branch switch、non-fast-forward、重叠冲突、Preview 已进入 Commit 或额外漂移会进入 recovery，而不是强行覆盖；
- cleanup 前验证 managed path、Git metadata 和最终 fingerprint；未知残余会保留或 quarantine；
- Finalize 的 durable Delivery Proof 绑定准确 Review，并保存 Commit、Local branch/HEAD、changed files 与 validation 摘要；动态历史证据不授予新的写权限；
- 历史不可逆 Apply 记录不会被自动 Finish 或 Discard。

更完整的状态机和权限矩阵见 [Worktree Console 架构](docs/WORKTREE-CONSOLE-ARCHITECTURE.md)。

## 当前限制

- 暂无跨项目全局 Worktree Manager（Worktree 管理器）；
- 关联 Worktree Manager 通过 Session Header 控制面板打开；当前仍不挂载常驻的 `conversation.view` 标签页；
- Harness 仍按 canonical cwd 把 Local 与各 Worktree Session 显示为独立 Workspace；插件管理器展示的是 `sourceSessionId` 关联，不改变 Harness 原生侧边栏归组；
- 在已验证的 Harness `0.1.1-rc.2` 包线中，Workflow `agent({ isolation })` 集成尚不可用；
- 子 Agent 继承父 Session cwd；只有父 Session 已经位于 Worktree Session 时，子 Agent 才处于相同隔离边界；
- dependency snapshot/restore（依赖快照与恢复）与完整 collaborator handoff UI（协作者交接界面）尚未实现；
- Checkpoint 目前只支持按创建顺序查看阶段摘要，不支持历史编辑、删除、重排或任意回退；
- 暂不支持 Isolated Session 申请受控事务直接维修真实 Local；
- cleanup 会删除本轮 Worktree cwd，但已交付 Session 可以在严格校验后重建路径并开始下一轮。

## 后续计划

以下是继续完善项目的可能方向，不代表已经承诺的发布时间：

### 近期

- 持续完善市场展示和端到端使用示例；
- 继续稳定 Ready（待验收）、Preview（Local 预览）、Rollback（撤回预览）、Finalize（确认提交）、cleanup（清理）与 iteration（任务轮次）恢复流程；
- 改善错误分类、recovery（恢复处理）指引和真实 Harness 版本兼容性；
- 根据实际使用反馈，评估是否还需要在 Header Manager 之外增加常驻 Worktrees 标签页。

### 中期

- 继续完善 Checkpoint 历史展示与真实 Harness 长任务使用反馈；
- 评估受控 Local 维修事务：由用户批准一次绑定当前 Local 状态的临时授权，让 Isolated Session 在不改变会话执行目标的情况下通过受限工具修复真实 Local，并自动恢复原任务；
- 迁移 dependency snapshot/restore（依赖快照与恢复），减少不同 Worktree 间重复安装依赖的成本；
- 完成 collaborator / subagent handoff（协作者 / 子 Agent 交接）生命周期，让协作任务可以安全释放并交付；
- 继续丰富关联 Worktree 列表、状态检查、保留期与清理管理；
- 丰富 Review（验收）展示，在不改变 Host 权威边界的前提下提供更清晰的差异和验证信息。

### 长期

- 建设跨项目全局 Worktree Manager（Worktree 管理器）；
- 在 Harness 提供稳定接口后接入 Workflow 级 `agent({ isolation })`（工作流级隔离）；
- 增加更完整的审计、运行指标和恢复诊断能力；
- 探索更完整的多任务并行调度、有序验收与跨 Session handoff（跨 Session 交接），同时继续保持 Local 写入必须由用户确认。

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

该命令会构建当前 checkout、打包临时 tarball、安装到 `web` profile、验证组合配置、准备受 marker 保护的临时 Git fixture，并默认在 `http://127.0.0.1:3081` 启动 `dsh web`。它不会发布 npm 包或 push Git refs。

常用变体：

```bash
# 只安装并验证当前快照，不启动 Web
pnpm run dev:dsh:install

# 验证已安装的 profile
pnpm run dev:dsh:smoke

# 指定 Git 根目录、端口或 Harness 源码 checkout
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web

# 移除开发安装和缓存的本地归档
pnpm run dev:dsh:remove
```

## 文档

- [Session Target 迁移说明](docs/PORTING.md)
- [Worktree Console 架构](docs/WORKTREE-CONSOLE-ARCHITECTURE.md)
- [UI 开发说明](docs/UI-DEVELOPMENT.md)
- [发布清单](docs/RELEASE.md)
- [变更记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
