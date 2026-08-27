# Changelog

本项目的显著变更记录在此文件中。版本号遵循 Semantic Versioning；在 `0.x` 阶段，minor 版本可能包含需要迁移的公开能力调整。

## [Unreleased]

### Changed

- Review 主操作改为更直接的任务文案：Ready 使用“预览修改”，Preview 使用“确认并保存”，Direct Finish 使用“跳过预览并保存”；同步更新恢复、Checkpoint 与确认弹窗文案，不改变 Host 交付语义。
- 将中英文 README 收敛为 Mermaid 驱动的项目首页，新增双语 Usage 指南承接完整操作、恢复、命令与排错；同时修正 Checkpoint 迁移状态，并明确项目级 Worktree 插件与 Domi 桌面工作台之间的产品边界。

## [0.6.0] - 2026-08-25

`0.6.0` 为长任务增加 Host-authoritative Worktree Checkpoint：用户可以把精确 Ready/Preview 阶段保存为隔离 Worktree 内部 Commit，清理当前施工状态后继续开发，同时保持 Local 完全不参与阶段提交，最终仍只交付一个累计任务 Commit。

### Added

- Review 卡新增“保存阶段并继续”；active Preview 使用“撤回 Preview，保存阶段并继续”，两者都通过同一个 Host mutation 完成，不由 Client 拆分撤回与保存请求。
- checkpoint domain、registry metadata、operation journal、内部 artifact retention 与 `recoverCheckpoint` 支持重启后收敛 HEAD/index，无法证明完整回滚时保留 `index.lock` 与恢复证据。
- strict Host/Remote/Client contract 新增 generation-bound `checkpoint` 方法；请求绑定 exact owner、checkout、revision、review、generation 与 single-flight request ID，完成请求支持精确幂等重放。
- Review 与关联 Manager 投影展示已保存阶段数量/摘要；Manager 继续只提供状态、导航和 owner lifecycle，不新增 Checkpoint mutation。

### Safety

- Checkpoint 只提交 managed Worktree 当前 staged、unstaged 与 untracked 的精确验收快照；Local branch/HEAD、refs、index、staged、unstaged、untracked 与 working-tree bytes 不被纳入阶段 Commit。
- active Preview 必须先在 Host 锁内安全撤回；acceptance holder、identity、revision/review/generation、Worktree fingerprint 与最终 CAS 任一变化都在写入前 fail closed。
- prepared Commit 先持久化 journal，再保留内部 ref；写后复验 detached HEAD、clean index 与 checkpoint tree。迟到请求、重复点击、旧 generation、外来 Session 和空阶段均被拒绝或安全去重。
- Checkpoint 会使旧 Review、Preview、Delivery/Recovery proof 失效并恢复 Working；多次阶段 Commit 仍只作为 Worktree 内部历史，最终 Finish/Finalize 向 Local 生成一个累计任务增量 Commit。
- strict Remote schema 保持 path-free，拒绝未知字段、危险路径和内部 `refs/dsh` 泄漏。

### Changed

- 包版本升级为 `0.6.0`；发布门禁与 Loader 方法面同步要求 `checkpoint` descriptor。
- 中英文 README、架构与发布 smoke 补充 Checkpoint 状态、不变量、恢复和人工验证边界。

## [0.5.0] - 2026-08-25

`0.5.0` 完成冲突与 detached Preview 的 Host 权威恢复闭环：恢复决策绑定 durable proof、严格 Remote contract 与写前后 CAS 复验，并将运行基线统一升级到 DeepSeek Harness `0.1.1-rc.2`。

### Compatibility

- 将全部直接 DeepSeek Harness 依赖与完整 peer 图从 `0.1.0-rc.8` 统一升级到 `0.1.1-rc.2`，避免 rc.8/rc.2 混合 runtime。
- rc.1 引入视觉模型支持并修复 Bubblewrap 可经宿主 `/proc/<pid>/root` 绕过文件约束的问题；插件不直接实现 sandbox，但使用修复后的统一 Host 包线。
- rc.2 继续收敛图片 Files API、预处理与 attachment pipeline；本项目接触的 Commands wire 仅新增可选 `originalDimensions`，现有 Worktree 协议不消费该字段。
- 验证结构化 Web Client 启动/inject、Session projection state/view 重构、Typert namespace 原子注册与 Connection transport hooks，不改变现有 Worktree Session Target、Recovery 与 Local 安全边界。
- 移除已过期的 rc.8 `minimumReleaseAgeExclude`；rc.2 依赖图现可直接通过仓库供应链冷却策略。

### Added

- `preview_detached` 新增 Host-authoritative Recovery Preflight：严格只读核对 durable receipt、四个 retained refs、Local HEAD/ref/tree/index/fingerprint、acceptance holder，并分别给出 rollback/finalize 的可证明结论与 64 位 generation。
- detached Preview 在同分支安全快进后可安全撤回或直接提交到最新 Local HEAD；写操作在 Host 锁内重算 proof/CAS，并保留后续 Commit、staged、unstaged 与 untracked 层。
- 无法证明安全时，Review Recovery surface 可显式请求精确 owner Agent 只读分析，或创建基于最新 Local HEAD 的 fresh managed Worktree handoff；旧 Worktree、Local、receipt 与 retained evidence 保持不变。
- Review Preflight 冲突新增显式“让 Agent 解决冲突”：先强制重检结构化 conflict identity，再通过 owner-only `resumeRevision` 恢复 Working，并使用 Harness 官方 `ISession.prompt()` 将 Local HEAD 与冲突文件交回精确 owner Session；不会自动 Preview、Finalize 或写入 Local。
- `stale_isolated` 新增独立的“重新生成验收结果”链路：保持 Ready 与严格 Read Only，不恢复 Working、不修改文件，只要求 Agent 等待后台写入停止、重新验证并生成新的 Ready Review。
- Preview/direct Finish 写前竞态返回 strict `worktree_apply_conflict` continuation，包含可去重的冲突 request ID、checkout/review/revision、Local HEAD 与受限冲突文件列表；显式恢复后由 Host 另行签发持久恢复 proof。

### Fixed

- rollback/finalize 增加独立写后 HEAD/ref/index/tree/fingerprint 验证；无法证明成功或完整回滚时保留 journal/artifacts 并进入 `recovery_required`，reconcile 不再仅凭 Commit HEAD 误报成功。
- detached Recovery Remote contract 使用 strict schemas，拒绝未知字段、非法 OID/generation、绝对/父级冲突路径与越界身份；Client 使用 identity-keyed single-flight cache，并在每次写操作、分析或 handoff 前强制重检。
- Recovery continuation 增加 Host-authoritative 持久 proof：conflict 在 mutation lock 内重跑 Preflight/CAS 后绑定 Ready/Working revision、review、Local HEAD 与安全相对冲突路径；`stale_isolated` 通过独立只读 Host 授权保持 Ready。浏览器持久请求严格穷举 kind 与精确字段，并在发送前逐字段复验 Host proof、cwd 与 active Session，关闭伪造 kind 绕过显式授权的路径。
- Recovery continuation 支持持久未发送请求、single-flight、重复点击去重、Session loading/streaming 延迟、Session 切换中止、旧请求被新请求替换，以及发送结果未知或失败后的显式重试。
- acceptance slot 从 `waiting` 释放为 `available` 时废弃旧 busy Preflight；自动预检失败不再因重渲染循环重试，改为用户显式“重新检查”。

## [0.4.0] - 2026-08-20

`0.4.0` 将 Worktree 验收升级为可预检、可恢复、可核验的交付闭环，并把关联 Worktree 的状态与导航入口集中到 Session Header；同时适配 DeepSeek Harness `0.1.0-rc.8` 与新的 Node.js 运行要求。

### Added

- Ready Review 卡与 composer dock 自动执行共享的严格只读 Preflight，展示 Local/Worktree HEAD、effective base、同步状态、冲突与 acceptance slot；真正 Preview 或 direct Finalize 前仍强制重新检查。
- `stale_local`、`stale_isolated`、冲突和过期 Review 增加明确恢复动作：重新检查，或恢复当前 Worktree 并预填重新验证、生成验收稿的请求；旧 Preview/Finalize 操作立即失效。
- `project_acceptance_busy` 返回 path-free 的 checkout/owner Session/state 摘要，并在 Host inspect、owner 身份和 canonical cwd 全部复验后导航到占用 Session。
- Finalize 后在 Review 卡与 composer dock 展示 durable Delivery Proof：Commit OID、Local branch/HEAD、changed files、validation 摘要，以及 cleanup/retention 结果。
- 将 Session Header 的 Target 状态胶囊升级为可点击控制面板，可直接打开当前工作位置、返回来源 Session、处理 owner cleanup，并在当前 Session 内打开“关联 Worktrees”管理器。
- source 与同源 target Session 现在都能列出并打开关联 Worktree；兄弟 Session 只获得只读发现与导航能力，不继承 Preview、Finalize、Discard 等 owner 写权限。

### Changed

- 关联 Worktree Manager 按当前目标和待处理状态排序，并复用已经存在的 Harness Session，避免导航时重复创建 Workspace/Session。
- Manager 聚焦状态、导航和 owner lifecycle，移除重复的“检查/验收”行操作及会破坏紧凑布局的展开详情；验收继续由专用 Review 卡与 composer dock 承担。
- 保持 `conversation.view` 标签页未挂载；管理入口集中在 Header 控制面板，避免与 Review 卡和 composer dock 重复。
- acceptance slot busy 时仅关闭 Local mutation capability，owner 的只读 Preflight 保持可用；跨 source 的额外 inspect 权限只对当前 Ready owner 的真实 slot holder 生效，且永不继承 mutation capability。
- Delivery Proof validation 字段以可选形式加入 version-2 registry，继续兼容历史记录。

### Compatibility

- 将 DeepSeek Harness 依赖与已验证兼容包线更新到 `0.1.0-rc.8`，并把 Node.js 运行要求同步为 `^22.19.0 || >=24.0.0`。
- 从干净安装重建纯 rc.8 DSH peer 图，避免 rc.7/rc.8 混用；已使用的 Session、Subprocess、Tool 与 Typert Remote 接口保持兼容。
- 补充独立社区插件声明，明确本项目不代表 DeepSeek 官方背书、合作或授权。

## [0.3.2] - 2026-08-19

`0.3.2` 将插件更新到已验证的 DeepSeek Harness `0.1.0-rc.7` 包线，并保持现有 Worktree Session Target 与验收交付接口兼容。

### Compatibility

- 将 DeepSeek Harness 依赖与已验证兼容包线更新到 `0.1.0-rc.7`；rc.6 → rc.7 的已使用公开类型与 Remote/Tool 注册接口保持兼容。
- 重新生成纯 rc.7 锁文件，消除 rc.6 peer 混用，并更新中英文环境要求与已知限制说明。

## [0.3.1] - 2026-08-18

`0.3.1` 修复验收卡操作菜单被卡片裁剪的问题，并将项目文档重组为中文优先、带完整产品流程截图的发布入口。

### Fixed

- Ready for Review Tool 卡片允许操作菜单溢出显示，避免菜单被卡片边界裁剪。
- 验收卡菜单改为向下展开，composer dock 中的同类菜单继续向上展开，并增加对应 CSS 回归测试。

### Changed

- 中文 README 成为默认入口，英文文档迁移到 `README.en.md`。
- 重写 Worktree 产品文档、迁移说明与架构入口，补充创建、Ready、Local Preview、提交、保留环境和下一轮修改的产品截图。
- 本地 DSH 开发 tarball staging 同步包含 `README.en.md`。

## [0.3.0] - 2026-08-17

`0.3.0` 完善同一 isolated Session 的连续修改体验：未同步 Review 可以安全恢复编辑，成功交付并 cleanup 后也能保留 Session ID、immutable cwd 与完整对话开始下一轮。

### Added

- cleanup 后在原 isolated Session 中开始 iteration + 1；新 checkout 从最新 Local HEAD 创建，并通过 `predecessorCheckoutId` 保留上一轮交付记录与迭代血缘。
- delivered composer dock 增加“开始下一轮修改”，模型增加 `worktree_begin_next_iteration`，人工命令增加 `/worktree next`。
- Host、strict Typert Remote、Client Adapter 与 Console Contract 增加 `beginNextIteration`；Remote 方法总数由 13 个增加到 14 个。
- cleanup 后 Harness 过滤缺失 cwd 的 Session 时，lookup adapter 可通过当前 live Session 的 immutable header cwd 恢复精确且唯一的 Workspace 身份。
- 新增 `worktree_resume_revision`、`/worktree continue` 与 Ready 更多菜单“继续修改”，在不写入 Local 的情况下使未同步 Review 失效并恢复同一 iteration。
- Worktree Console Contract、Host、strict Typert Remote 与 Client Adapter 增加 `resumeRevision`；Remote 方法总数由 14 个增加到 15 个。

### Fixed

- 修复 `worktree_ready_for_review` 输出 Schema，使其符合 Harness 工具结果契约。
- 发布产物门禁同步校验新增的 `beginNextIteration` 与 `resumeRevision` Remote 方法。
- 完善并稳定本地开发 Harness 的源码预览、验收输出提取、命令失败诊断与跨平台路径处理。

### Safety

- 下一轮仅允许已成功清理的 delivered owner，并校验 caller、Workspace、revision、Local Git common dir、managed path 与 predecessor lineage。
- 如果上一轮 managed path 已重新出现或包含未知内容，拒绝覆盖；retained、cleanup-pending 与 recovery 状态必须先完成清理或恢复。
- 创建中断且尚未形成 Worktree 时，reconcile 恢复 predecessor binding；存在无法确认的残留时进入 recovery 并保留现场。
- live Session cwd fallback 对 cold、无 cwd、路径不匹配或歧义映射继续 fail closed。
- resume-revision 严格校验 live owner Session、expected revision、expected review ID、Workspace/checkout 身份；转换只更新 registry delivery state，不修改 Local、Worktree bytes 或 Git refs。

### Changed

- Ready for Review 不再阻断普通对话：讨论类 follow-up 保持当前 Review；新的代码或文件修改由模型自动恢复 Working，不要求用户先同步或点击恢复编辑。
- 重写中英文 README，补充当前 Session Target 流程、安全边界、命令、模型工具和已知限制。
- `SessionCheckoutModule.beginNextIteration` 现在要求调用方传入 `expectedRevision`，避免基于过期 delivered 状态创建下一轮。

## [0.2.0] - 2026-08-17

`0.2.0` 将插件从单一 Worktree 管理器升级为 DeepSeek Harness 中完整、可验收、可撤回的 Worktree Session Target。

### Added

- 真实 source/target Session 分离：Host 分配唯一 checkout、managed root 与 target Session ID，source Session 始终保持 Local。
- blank Local Session 的 pre-session **Worktree** 开关与确认弹窗：确认前零副作用，确认后才创建 target、迁移未发送的文字/图片并打开独立 Session。
- Harness 官方 Slot 集成：
  - Create/Ready ToolView；
  - Header Session Target 状态胶囊；
  - `conversation.input.dock` 的 Ready、Preview 与 Recovery 状态条。
- 两阶段验收交付生命周期：
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

- 发布初版生产级 Worktree 管理、基础 apply/finish/discard 生命周期和安全清理。

[0.6.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/wloops/dsh-git-worktree/releases/tag/v0.1.2
