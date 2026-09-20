# Changelog

本项目的显著变更记录在此文件中。版本号遵循 Semantic Versioning；在 `0.x` 阶段，minor 版本可能包含需要迁移的公开能力调整。

## [Unreleased]

## [0.9.2] - 2026-09-20

`0.9.2` 修复 Managed Worktree 未携带项目级 Skill 及其资源的问题：首次创建和交付后的下一轮创建都会获取一次 Local 快照，并让 `.claude/skills` 与既有 `.dsh/skills`、`.agents/skills` 一起在隔离 Session 中可用，同时保持辅助文件与正常 Git 交付隔离。

### Fixed

- 创建首次及下一轮 Managed Worktree 时一次性携带项目 `.dsh/skills`、`.agents/skills` 和 `.claude/skills` 的本地文件与资源，并接入 `.claude` Skill 加载；携带的辅助文件不自动混入交付，已跟踪改动与显式暂存保留正常 Git 语义。
- Local 中已跟踪 Skill 存在未提交修改、删除或基线冲突时保守拒绝，不静默覆盖；复制中断、不同内容、未知资源或链接会保留现场，不反向同步 Local，也不自动清理可能有价值的内容。
- Skill 快照复制改用 Node 文件 API，拒绝符号链接、junction 与项目外链接，并限制文件数、总大小、目录项和目录深度；无需增加原生复制工具依赖。

### Compatibility

- 新增 `@deepseek-ai/dsh-fs` peer，并使用与现有开发基线一致的 `0.1.2-rc.1`；`.claude` Skill 通过上游 filesystem Skill provider 加载。
- 现有 Managed Worktree 不自动补拷 Skill；在首次创建或完成交付后的下一轮创建时获取新快照。无需迁移 Worktree registry、Review、Recovery 或 Session 数据。

## [0.9.1] - 2026-09-15

`0.9.1` 修复 Windows 长路径和慢速仓库中 Worktree 创建失败或超时的问题，并减少状态与预览流程的重复 Git 查询；失败清理继续以可证明归属为前提，不修改用户 Git 配置、不全局 prune，也不删除未知锁或残留。

### Fixed

- Windows 下为创建、检出、状态与验收交付的 Git 调用启用命令级长路径支持，修复 Worktree 路径前缀增长导致的 Filename too long；不修改用户 Git 配置或跳过 LFS。
- Worktree 创建使用独立可配置的 5 分钟共享时限，普通 Git 默认从 30 秒提高至 2 分钟；失败后等待进程树退出，验证本次目录、元数据和残留内容后回滚并恢复原会话绑定，允许手动重试。无法证明安全的残留继续保留，不全局 prune、不删除未知锁；稀疏检出保持原生语义。
- 减少状态读取与 Worktree 管理列表的重复 Git 查询：复用同次只读请求的调用者检查及同次目录验证结果，保留预览、交付、清理的实时安全校验与锁。
- 合并 Git common directory 与 worktree Git directory 的身份路径查询，减少进程启动开销；对包含换行的路径保留单值查询回退。

### Compatibility

- 继续使用既有 DeepSeek Harness peer 范围和 Worktree registry；无需迁移数据或修改 Git 配置。
- 新增 `gitTimeoutMs`（默认 2 分钟）与 `worktreeAddTimeoutMs`（默认 5 分钟）配置，现有配置不需要补写。

## [0.9.0] - 2026-09-11

`0.9.0` 完善新会话创建、验收与项目导航体验：空仓库可在明确确认后安全建立首次提交；Worktree 入口恢复为与 DSH 工具栏协调的原生紧凑开关；验收区增加只读详情弹窗，并修复撤回预览、历史 Worktree 分组及慢请求轮询的状态问题。

### Added

- 新会话目录入口支持无提交 Git 仓库：Host 先执行只读预检，再经用户明确确认创建空首次提交；不纳入用户文件或暂存内容，不改写 Git 身份，并在状态变化或失败后安全拒绝、允许重试。
- 验收条新增 Lucide 图标化只读详情弹窗，集中展示文件列表、验证记录和版本信息；操作仍留在验收条，历史卡保持结果导向的精简展示。
- Host 为历史 Managed Worktree 提供不含路径的导航归属投影，侧边栏可将过滤后的历史分组和未归组会话安全合并回原项目，同时保留歧义项与普通成员。

### Changed

- 新建 Session 的目录入口改为 Harness 原生紧凑菜单与 Worktree 开关，跟随真实状态恢复，并与 DSH 工具栏尺寸、主题反馈和图标体系保持一致。
- cleanup 后的“开始下一轮修改”移至 owner Session 顶部 Worktree 菜单；验收条聚焦当前摘要、文件数、验证状态与交付操作。
- 统一 Worktree 管理、Preview、详情和更多操作的 Lucide 图标与间距，减少重复标题、常驻外框和开发辅助文案。

### Fixed

- 修复新版 Harness 中新会话 Worktree 开关点击后无响应：适配当前 `attachmentIds` 快照和源/目标 Session 输入操作，同时兼容旧版图片接口；草稿与附件可安全迁移到新 Session。
- 将输入快照创建纳入异常恢复，失败时释放忙碌锁、显示错误并允许重试，避免入口永久停留在准备状态。
- 撤回 Local Preview 后继续保留同一验收身份，避免旧异步结果覆盖；区分“撤回预览”和“继续修改”，并展示真实文件数、验证状态和 revision 防回退结果。
- 缓解 #6 的后台状态查询开销：状态按钮与验收栏共享按 Client adapter、会话及语言隔离的展示查询；慢请求完成后再调度，主动刷新合并并丢弃失效结果，避免重复轮询和未完成请求堆积。
- 展示查询在卸载时停止调度，重挂载不消费旧请求结果；创建、交付和清理的实时安全校验保持独立且不降级。
- 修正发布门禁的 Remote 方法清单，补入已存在且已有回归覆盖的 `preflightCreate` 与 `createWithInitialCommit`；不改变运行时协议。

### Documentation

- 增加新旧 Harness 兼容矩阵，区分开发基线、peer 声明、用户反馈、部分实测与未验证项；记录 `0.8.0` 对 `0.1.5-rc.1` 的隔离验证及端到端限制，不强制升级 Host，不扩大依赖声明。
- 清理过时 UI Skill 和并行开发交接稿，按当前实现更新 UI 维护指南、Console 模块职责与验证入口。

### Compatibility

- 开发与可重复构建基线仍为 DeepSeek Harness `0.1.2-rc.1`；`0.1.5-rc.1` 只有用户反馈和部分隔离验证，不扩大 peer 声明，也不要求现有用户升级 Host。
- 新增空仓库首次提交能力和历史导航投影，不迁移既有 Worktree registry、Review、Recovery 或 Session 数据。

## [0.8.0] - 2026-09-09

`0.8.0` 为插件增加 Client 与 Host 全链路中英文支持：界面、工具、命令和 Host 用户消息跟随 DSH 语言选择，并通过显式 Console 语言传递与异步上下文隔离保持并发会话正确；同时修复新建 Session 时 Worktree 入口因使用过期状态 seam 而崩溃的问题。

### Added

- 接入 DSH locale 与类型安全的中英文文案表，覆盖 Pre-session、Target/Review Console、ToolView、Workspace Sidebar、工具结果、命令回复和 Host 生命周期消息；插件不增加独立语言开关。
- Console contract 显式传递调用语言；Host 使用异步语言上下文隔离并发工具和命令，错误码、持久化判定及恢复协议继续保持语言无关。
- 新增语言标准化、中文回退、插值、运行时切换、并发隔离和 strict transport 回归，并将语言传递与翻译贡献规则收录到发布包的 `docs/i18n.md`。

### Fixed

- 新会话 Worktree 入口改用 DSH `0.1.2-rc.1` 标准 Session 与输入状态 hook，避免渲染期读取旧 store seam 导致崩溃；中英文环境下均覆盖确认、取消和会话状态变化。

## [0.7.5] - 2026-09-06

`0.7.5` 修复插件启停时官方 Workspace provider 与 Managed 聚合 provider 的生命周期协调：禁用插件后可靠恢复官方 `uiWorkspace`，启用时继续保留 Managed 会话聚合，不再因静态 bundle patch 残留导致 Web 会话阻塞。

### Fixed

- 修复 #4：插件条目禁用但 bundle patch 仍保留时，恢复官方 `uiWorkspace`，不再因双方均停用阻塞 Web 会话；启用时继续保留 Managed 会话聚合和侧边栏标记。
- Workspace 替换改为 Host 生命周期控制的条件选择；同步 Loader 与 Web 模块清单，覆盖延迟 Include、市场禁用状态回放和初始化失败恢复，不持久化官方禁用标志。
- 新增锁定 DSH `0.1.2-rc.1` 的真实 Loader / Include / ClientModuleRegistry 回归；切换后仍应完整重启 DSH 并重新加载页面。

## [0.7.4] - 2026-09-04

`0.7.4` 修复 `0.7.3` 在 DeepSeek Harness `0.1.2-rc.1` Web Client 中的启动循环依赖。插件现在先恢复被受控派生替换的官方 `uiWorkspace` 服务，再延迟加载依赖 Conversation 的 Worktree 界面。

### Fixed

- 将官方 Workspace Client 与 Worktree ToolView/Pre-session/Target/Review UI 拆分为两个 Cordis 激活阶段，消除 `dsh-git-worktree → conversation → uiWorkspace → dsh-git-worktree` 循环等待。
- 顶层 Client fiber 只等待官方 Workspace 的公开 prerequisites；`conversation` 与 `connection` 留在子 fiber，服务后续出现时再注册其余 Worktree UI。
- 增加无 Conversation 启动图回归和发布门禁，确保插件先提供 `uiWorkspace`，且官方 Workspace Slot declaration tree 仍只注册一次。

## [0.7.3] - 2026-09-03

`0.7.3` 将插件完整适配到 DeepSeek Harness `0.1.2-rc.1` 的 Host、Client、Remote Gateway 与 Workspace 模块边界，并重写中英文项目首页，让安装要求、Worktree 工作方式与安全限制更容易理解。

### Changed

- 用面向普通用户的语言重写中英文 README，保留 Git Worktree 隔离、多任务并行、人工验收与恢复能力说明，并明确该工作方式与 Domi/Pi Agent Runtime 开源实现的来源关系。

### Compatibility

- 将 DeepSeek Harness Host singleton、Client 模块与完整锁图统一升级到 `0.1.2-rc.1`，同时对齐 Cordis `4.0.2` 和 Schemastery `3.18.2`，避免 rc.2/rc.1 混合运行时。
- 适配 rc.1 的 Client 拆分：移除已停止发布的 `dsh-client-runtime`，改用 Session/Workspace API Controller、`dsh-client-store` 与 Cordis Context 的公开类型和模块边界。
- 重新固定官方 Workspace Client `0.1.2-rc.1` 的 bundle SHA-256，并更新 Managed owner Browser 派生 seam；官方 Picker、locale、store、目录选择授权和 Slot declaration tree 保持不变。
- 适配统一 Remote Gateway：Client Remote 现在包含 generation stream 与 Host facts，测试载体实现新的 Connection lifecycle，卸载后错误码按官方命名空间收敛为 `gateway/internal`。
- 已复核 Session 按需事件 API（`seq`、`eventAt()`、`snapshotEvents()`）和 `SessionSeq` / `SessionLogOffset` 强类型；插件不直接读取已移除的 `Session.events`，现有 Session Target、fork/resume、Recovery 与 Local fail-closed seam 保持不变。
- 补充 rc.1 Host 升级说明：Code Mode 更名为 PTC mode 且旧会话仍可读取；可选 SQLite Session 后端已移除，存量数据需使用旧版 Harness 导出；应用与插件安装统一通过 `dsh` Profile。

### Security

- 双语 README 跟随上游安全声明，明确 Harness 与本插件均未经独立安全审计，Worktree、审批和权限检查不构成绝对沙箱保证。

## [0.7.2] - 2026-08-30

`0.7.2` 修复 Review 历史提交信息的持久化上限、DSH Host singleton 包的依赖边界，以及非 Git Workspace 的 Worktree 入口显示，避免 registry 写入失败、重复 Host 实例和无效创建入口。

### Fixed

- `previousReview.suggestedCommitMessage` 在投影和 registry 加载修复阶段限制为 500 字符，并安全处理 UTF-16 高代理项，避免超长建议提交信息使后续状态无法持久化；已有受影响记录会在读取时自动收敛。
- 将 Cordis、Session、Agent、Commands、Subprocess、Tools、Typert 等 DSH Host singleton 包从运行时 dependencies 移至 peerDependencies，并以精确 devDependencies 保持构建测试可复现；发布门禁会拒绝 singleton 回流 dependencies、缺少 peer 或测试版本漂移。
- pre-session 在仓库检测完成前不再显示 Worktree 开关，非 Git Workspace 检测完成后保持隐藏；Host 对 `unversioned` 目标同步关闭 create capability，避免渲染竞态或绕过 Client 入口。

## [0.7.1] - 2026-08-28

`0.7.1` 修正项目聚合侧边栏的 Managed owner 菜单边界：恢复安全的会话整理操作，隐藏尚不具备 Worktree 生命周期语义的普通 Fork，并继续阻止会破坏唯一 owner 不变量的入口。

### Fixed

- Managed owner 恢复官方重命名与归档；归档仅影响侧边栏可见性，不放弃任务、不清理 Worktree，也不改变交付状态。
- 普通 Fork 从 Managed 菜单隐藏；Managed Workspace 的“新会话”和跨归属拖动继续被阻止，非法操作不再弹出浏览器原生提示框。
- 强化冲突 Workspace 的 fail-open 防护，并更新项目聚合、Ready 界面截图与双语使用说明。

## [0.7.0] - 2026-08-28

`0.7.0` 新增项目聚合侧边栏，将 Managed Worktree 的唯一 owner Session 直接显示为原 Local 项目下的任务行，同时以 fail-open 拓扑、生命周期操作限制和上游版本门禁保持官方 Workspace 行为兼容。

### Added

- 新增项目聚合侧边栏：Local Workspace 继续承载普通多会话，每个 Managed Worktree 则直接显示为唯一 owner Session 任务行，并展示进行中、待验收、预览、恢复、已完成或已放弃状态。

### Changed

- Managed Workspace 不再以 UUID 长路径重复占用顶级项目；cleanup 后的历史 owner Session 继续依据插件 Registry 归入原 Local 项目。
- Managed 任务行仅用于打开 owner Session，普通重命名、Fork、归档和拖动会被阻止，避免产生第二个会话或绕过 Worktree 生命周期；非托管 Workspace 保留官方操作，拓扑不可用时完整回退到原 Workspace 列表。
- 修复项目聚合 Browser 的两阶段真实启动回归：先消除重复 `sidebar.workspaces.directoryFlow` 声明，再改为版本与 SHA-256 门禁的官方 Workspace Client 单次衍生加载，保留 `renderSlot`/目录选择授权，避免 shadow 崩溃后静默回退官方侧栏。
- Managed Workspace 中可证明为空的预会话 launcher 不再阻止聚合；真实第二个 Session 仍 fail-open，物理 Workspace 未归并时也会禁止通过官方“新会话”入口创建第二个 Session。
- Managed owner 行改用官方 Branch Icon 与独立状态 Badge，任务标题保持原文；窄侧栏会优先保留 Worktree 身份和交付状态，而不是把状态截断在标题末尾。

## [0.6.1] - 2026-08-28

`0.6.1` 统一 Preview 与最终保存的用户文案，修复 pre-session source launcher 对并发 Worktree 创建的阻塞，并让普通 Local Checkout 正确使用正常助手回复结束任务；同时将项目首页和完整使用指南重新分层。

### Changed

- Review 主操作改为更直接的任务文案：Ready 使用“预览修改”，Preview 使用“确认并保存”，Direct Finish 使用“跳过预览并保存”；同步更新恢复、Checkpoint 与确认弹窗文案，不改变 Host 交付语义。
- 将中英文 README 收敛为 Mermaid 驱动的项目首页，新增双语 Usage 指南承接完整操作、恢复、命令与排错；同时修正 Checkpoint 迁移状态，并明确项目级 Worktree 插件与 Domi 桌面工作台之间的产品边界。

### Fixed

- pre-session handoff 成功后自动归档已清空的 Local source launcher，防止 Harness 的 New Session 复用该 reserved source 并错误阻塞下一项并发 Worktree 任务；owner Session 与项目级 Preview 串行约束保持不变。
- 普通 Local Checkout 现在明确使用正常助手回复结束，不再被引导调用 Worktree-only Ready 工具；若模型仍误调用，Client 会隐藏预期的 `target_unselected` 结果，同时保留其他真实 Worktree 错误。

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

[0.9.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/wloops/dsh-git-worktree/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/wloops/dsh-git-worktree/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/wloops/dsh-git-worktree/releases/tag/v0.1.2
