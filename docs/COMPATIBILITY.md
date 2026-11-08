# Harness compatibility / Harness 兼容性

> 当前开发版安装策略：DSH peer 使用最低版本 `>=0.2.1-rc.2` 并显式包含 `0.2.2-rc.1`，不设置预防性上限；仅在确认破坏性变化后调整要求。开发依赖和内嵌侧栏来源继续精确锁定。未知宿主不复用旧侧栏，而保留官方 Workspace，其他插件功能按实际 API 运行。允许安装并不等于已验收；SemVer 默认仅自动包含同一 `0.2.1` 核心版本的后续 RC，未来其他核心版本的预发布不属于默认匹配。下方精确 peer 描述均为已发布历史版本的记录。

> Development installation policy: DSH peers use a minimum of `>=0.2.1-rc.2` plus explicit `0.2.2-rc.1`, with no speculative upper bound; requirements change when breaking changes are confirmed. Build dependencies and embedded Browser sources remain exact. Unknown Hosts retain the official Workspace rather than reusing an unverified derivative. Installation permission is not acceptance evidence. Standard SemVer includes later RCs of the same `0.2.1` core; prereleases of other future cores are not matched by default. Exact peer constraints below describe historical published releases.

[中文](#中文) · [English](#english)

## 中文

### 官方原生集成迁移

未知 Host 不再只剩未扩展的官方列表：在官方声明行尾或悬浮 Slot 时，插件按能力挂载 Worktree 标记；没有对应槽则等待声明，不接管 Provider，不改全局数据。已知版本仍保留聚合派生，**尚未实现无白名单的完整聚合**。原因及最小官方接口提案见 [长期集成说明](SIDEBAR-NATIVE-INTEGRATION.md)。

### 未发布：0.2.2-rc.1 侧栏适配

原因为 Host exact-version 门禁尚不识别 `0.2.2-rc.1`，因此有意保留官方 Provider，未应用 Worktree 聚合。当前新增独立 exact version/SHA-256 来源，经 strict Remote `modern-022` 选取；不是放宽版本号后套用旧 Browser。构建基线仍 rc.2，新增 alias 仅用于来源；peer 显式包含新预发布，以及 Cordis 4.1 / Loader 1.1，不打入私有 singleton。

保留新版结构化右键菜单、资源权限、Session ID 搜索、手动排序、选择恢复、路径悬浮信息、AnimatedRows、行首/行尾/悬浮扩展与原生状态语义。托管 owner 的置顶、重命名、复制 ID、归档继续可用；fork、新建及受保护工作区管理仍经过所有权 guard。

**官方自定义结论：** 已支持插件级行首（idle 时）、行尾、悬浮卡片、快捷按钮、旧式菜单 Slot，以及结构化 `ctx.contextMenus.register`。未发现用户可配置的列表模板或公开的 Workspace 成员投影扩展；现有接口不足以直接完成 Worktree 跨工作区聚合，所以本轮仍使用精确派生，不移除官方扩展槽。

已执行来源/源码语义、实际构建 Browser 的 jsdom 聚合与菜单、CSS、Loader 回归，并用 Chromium 假数据静态行样例确认截断、徽标尺寸及悬停隐藏。**这不是完整 0.2.2 Host 验收**：当前开发 singleton 仍 Cordis 4.0.5 / Loader 1.0.6；新运行时 4.1 / 1.1、真实菜单键盘/焦点、desktop、AI 和 Windows 全流程未验证。未发布或修改用户安装。

### 历史：0.2.1-rc.5 侧栏适配

当前未发布源码（包版本暂仍 `0.12.0`）为 `0.2.1-rc.5` 新增独立官方 Workspace 来源与包名/版本/SHA-256 门禁，Host 实际解析的 agent 版本通过 strict Remote `modern-rc5` 选择该 factory。rc.2 仍选原 `modern` factory；alpha/next 与未知 Host 官方降级保持。保留 rc.5 blank 复用、preset 筛选及草稿初始化，不用旧 factory 冒充新 Host。

本轮仅在隔离依赖树运行源码、实际 `lib/client.js` jsdom Browser 聚合/标题/状态、CSS 清理及真实 Cordis Loader 生命周期回归。开发 Host singleton 仍 rc.2，rc.5 alias 仅提供构建源码；未启动 rc.5 Host、未修改用户 desktop/配置、未做真实浏览器/AI/Windows 全流程。已发布 `0.12.0` 不含此修复。

**兼容性描述的是插件版本与 Harness 运行环境的组合，不是“只有最新 DSH 才能用”。** 新增一个版本的测试记录不会撤销旧组合的支持；未验证也不等于不兼容。

### 验证矩阵（2026-09-11）

| 插件 | Harness | 证据与范围 |
| --- | --- | --- |
| `0.8.0` | `0.1.2-rc.1` | 当时的开发/构建基线。typecheck、build、30 个测试文件通过（431 passed、2 skipped），含 Session Target、Review、Recovery、Local 写入保护回归。本轮未重做此组合的真实浏览器全流程。 |
| `0.8.0` | `0.1.5-rc.1` | 用户报告可用；隔离官方 Profile 安装和配置组合成功。Host 的 231 个 DSH 包均为 rc.1；关键动态导入、strict Typert 正常调用/非法输入拒绝通过；以新 Host 包运行的 39 项 Remote、Workspace provider 生命周期和工具表面测试通过。真实 Web 到达首次引导，但本轮未完成引导后的界面与会话端到端验收，故为**部分验证**，不是已知不兼容。 |
| `0.8.0` | `0.1.5-rc.2`、`0.1.5-alpha.*` | 本轮未验证，不声明兼容或不兼容。 |
| `0.7.4`、`0.7.5` | `0.1.2-rc.1` | 历史修复针对的组合：分别修复 Workspace/Conversation 启动环和插件启停 provider 协调。见 CHANGELOG；不是本轮对历史版本的重新测试。 |
| `0.7.3` | `0.1.2-rc.1` | 已知可能出现 Workspace/Conversation 启动循环依赖，修复始于 `0.7.4`。 |
| `0.7.2` 及更早 | `0.1.2-rc.1` | 使用已移除的 `dsh-client-runtime`，不适用于此 Host 包线。这不意味着这些插件在原来的旧 Host 上也不可用。 |

没有逐项验证的中间版本不能由两端版本推导为连续兼容范围。当前正常工作的已验证旧组合不需要因为上游发布新版而被强制替换。

### Issue #9 后续检查（2026-09-25；插件 0.9.3）

插件 `0.9.3` 在 strict Remote codec 中同时保留旧版 `schema` 和新版 `create()`；Client 会话切换优先使用新版 `uiWorkspace.openSession`，旧版回退到 `sessions.open`；新版选中会话读取唯一的 `retainedBy.mainView`，冲突则拒绝危险操作。官方 Workspace Browser 已分别从 rc.1、`0.1.6-alpha.2` 和 `0.1.7-rc.2` 精确版本/SHA 派生，按 Host 实际解析的 `dsh-agent` 包版本只注册一个 Slot 树；未知版本保留官方 Workspace，不猜测来源。受管会话/工作区在新版派生中屏蔽危险行操作、保留状态标记。**构建和单元测试不是新版 Host 的浏览器验收。**

| Harness | 当前状态 |
| --- | --- |
| `0.1.2-rc.1` | 锁定依赖的构建和测试基线；以上新增回归可运行。 |
| `0.1.5-rc.3` | npm `latest` 标签（本次检查）；尚未用独立 Profile 联调，不声明支持。 |
| `0.1.6-alpha.2` | 已完成对应官方 Browser 的精确派生、strict codec 和新版导航/会话选择适配，通过本地构建与源码结构回归；**尚未在隔离 Profile 启动、渲染或完成创建/切换联调，不声明运行时兼容**。 |
| `0.1.7-rc.2` | 对应官方 Browser 精确派生。以源码 Host 在全新隔离 `DSH_HOME` 完成 Profile 首次/重复无豁免安装、配置 smoke 和 Web 启动；真实浏览器完成页面渲染、Worktree 开关、一次性仓库的预会话创建与草稿迁移、受管侧栏「进行中」标记及刷新后恢复选中。**未配置 API Key，未验收 AI 对话、Review/恢复/清理全流程；不声明完整运行时兼容。** |

隔离联调命令见 [本地开发](USAGE.md#本地开发)。源码 Host 的 `sessions.create()` 仅登记目标身份；本轮真实创建曾因立刻借用未 retain 的 binding 而自动回滚，现经官方 `sessions.using()` 持有目标引用、完成草稿迁移与导航后复测通过。下一步仍需在 alpha.2 独立 Profile、配置好 API Key 的测试环境验证真实对话与 Worktree 生命周期；未知上游版本不会自动使用任何派生 Browser。

### 0.2.0-rc.2 适配（2026-09-30；插件 0.10.0）

插件 `0.10.0` 将 DSH peers 与开发依赖整体切换到 `0.2.0-rc.2`（精确版本），官方 Workspace Browser 派生门禁从 rc.1 换为 0.2.0-rc.2（版本/SHA-256 双门禁），保留 `0.1.6-alpha.2`、`0.1.7-rc.2` 两个旧代派生；运行时仍按 Host 解析的 `dsh-agent` 版本只选择一个派生。本轮修复：`remote.directoryPicker` 注入环导致的 Web 启动死锁、strict codec 缺失 `modern` flavor、四条派生 seam 与 `IconBranchOutlineRegular` 图标命名对齐 0.2.0。

| 验证项 | 结果 |
| --- | --- |
| 隔离 `DSH_HOME` + 源码 Host（`dsh-v0.2.0-rc.2`）dev 安装（typecheck/build/pack/profile install） | 通过，多次重复 |
| Web 启动 | 全部条目激活（修复前 12 条目 pending、插件卡 loading） |
| 真实 Chromium（自动化驱动） | 页面渲染、会话创建、侧栏列表 |
| Worktree 开关 → 确认 → 预会话创建 | Worktree 实际创建，托管行带「进行中」标记（`data-managed-worktree`），无渲染错误 |
| 单元/类型 | typecheck 通过；40 个测试文件 552 passed / 1 skipped |

**未验收（不声明完整运行时兼容）**：API Key 配置下的真实 AI 对话；Review/预览/交付/回滚/恢复/清理全流程；Windows；npm 安装版 Host（本轮仅源码 runner）；桌面端。插件 peers 精确锁定 `0.2.0-rc.2`：0.1.x Host 不在 0.10.0 目标内，0.1.x 用户继续使用 0.9.x 插件线（其对 0.1.x 的支持记录见上节，不因本节而撤销）。

### 0.2.1-rc.2 适配（插件 0.11.0；发布前源码兼容验证）

插件 `0.11.0` 已发布到 npm，DSH peers 与开发依赖精确锁定 `0.2.1-rc.2`。该版本不需要 Worktree registry、Review 或 Recovery 数据迁移；历史组合的支持记录不变。

以下为发布前、包版本仍为 `0.10.1` 时的源码兼容验证记录，不代表对最终 `0.11.0` 发布包重新进行了测试或全流程验收。全新项目内隔离安装后，typecheck、build、sidebar 版本/SHA 门禁、发布检查均通过；43 个测试文件 **607 passed / 1 skipped**，其中真实 Cordis Loader/Web registry 生命周期 **24 passed**。本轮修复 live disable 后官方 Provider 未恢复及 replacement 激活失败后的双 Provider：显式释放 marker、等待禁用 fiber、通过公开 `entry.init()` 替换已销毁引用，并按身份撤回失败/禁用的 replacement 引用。配置不持久化，启动仍不等待选举，保留超时和在途保护。

**该验证仅覆盖源码兼容性**：验证期间未启动正式/隔离 DSH Profile，未完成 `0.2.1-rc.2` 浏览器、真实 AI、桌面或 Windows 全流程；旧版本的浏览器证据不可转用为新版本验收。唯一 skipped 是 Windows 专用长路径测试。确切命令、根因和审查入口见 [0.2.1-rc.2 报告](compatibility/0.2.1-rc.2.md)，机器结果见 [JSON](compatibility/0.2.1-rc.2-validation.json)。

### 三种版本约束不要混淆（当前源码）

1. **开发基线**：DSH 开发依赖精确为 `0.2.1-rc.2`；Cordis `4.0.5`、loader `1.0.6`、include `1.0.10`、schemastery `3.18.5`。旧 alpha/next Browser 别名仅用于构建来源门禁，不是私有 Host singleton。
2. **安装声明**：当前 DSH peers（含 locale）精确为 `0.2.1-rc.2`，Cordis peer 为 `~4.0.5`，loader 为 `~1.0.6`。这是 package.json 的安装声明，不是所有 peer patch 版本的运行时证明。`0.9.3` 历史上的多数 DSH `^0.1.2-rc.1` 与 locale `0.1.2-rc.1 || 0.1.7-rc.2` 不再是当前声明；历史记录仍保留。官方 Profile 由 Host 提供运行时，不能为了消除 peer 警告补装另一套 singleton。
3. **Workspace 派生**：当前 bundle 来源为 `0.2.1-rc.2`、`0.1.6-alpha.2`、`0.1.7-rc.2`，逐一经过版本/SHA-256 门禁。Host 实际解析的 `dsh-agent` 版本选择单一派生；新 modern 不复用于 `0.2.0`，未知版本保留官方 Provider。保留旧派生不等于当前 peers 支持旧 Host，来源门禁也不是浏览器验收。

历史可用组合不因当前源码升级被撤销；未覆盖的运行时生命周期仍需单独验收。

### 升级与回退

- `0.1.5-rc.1` 使用 Session V3 数据格式；不要用旧 Host 读取升级后的新日志。测试新版本请使用隔离 `DSH_HOME` 和测试仓库；迁移前备份原环境，回退时恢复原数据而不是只降级 npm 包。
- `0.1.2-rc.1` 移除了可选 SQLite Session 后端，旧数据应先用原版本导出。
- CLI 版本不等于完整 Profile 包版本。记录实际解析的 DSH 包；例如 `^0.1.5-rc.1` 可以解析到同核心版本的后续 RC。本轮安装结果未混入 rc.2。
- 2026-09-11 查询官方 npm：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`。这些是本轮时间点的记录，不是永久更新承诺。

本轮没有足够证据要求已经正常使用 `0.1.5-rc.1` 的用户降级，也没有足够证据宣布所有新版本完全兼容。完整检测证据与限制见 [2026-09-11 检测报告](compatibility/2026-09-11.md)。

## English

### Unreleased: 0.2.1-rc.5 sidebar adaptation

Unreleased source (package version still `0.12.0`) adds a separately name/version/SHA-256-gated official rc.5 Workspace factory. Host-resolved agent version travels through strict Remote topology as `modern-rc5`; rc.2 still selects `modern`. Alpha/next sources and unknown-Host official fallback remain intact. The rc.5 factory retains blank reuse, preset filtering and draft initialization rather than relabeling an old factory.

Validation uses an isolated dependency tree, source tests, actual emitted `lib/client.js` Browser aggregation/title/status and CSS jsdom tests, and real Cordis Loader lifecycle regressions. Host singleton dev dependencies remain rc.2; the rc.5 alias supplies build source only. No rc.5 Host startup, user desktop/config modification, real browser, AI or Windows end-to-end acceptance was performed. Published `0.12.0` does not include this fix.

**Compatibility belongs to a plugin/Host combination, not to “the newest DSH only.”** Testing a newer Host does not withdraw older support; untested does not mean incompatible.

| Plugin | Harness | Evidence and scope |
| --- | --- | --- |
| `0.8.0` | `0.1.2-rc.1` | Development/build baseline at that time. Typecheck, build and 30 test files passed (431 passed, 2 skipped), including Session Target, Review, Recovery and Local write-protection regressions. No fresh browser end-to-end run for this combination in this check. |
| `0.8.0` | `0.1.5-rc.1` | User-reported working; isolated official Profile installation/configuration, imports and strict Typert checks passed. All 231 installed Host DSH packages were rc.1. 39 focused Remote, Workspace provider lifecycle and tool-surface tests passed with new Host packages. The real Web UI reached onboarding, but post-onboarding UI and Session end-to-end acceptance remain incomplete: **partially verified**, not known incompatible. |
| `0.8.0` | `0.1.5-rc.2`, `0.1.5-alpha.*` | Not tested in this check; neither compatibility nor incompatibility is claimed. |
| `0.7.4`, `0.7.5` | `0.1.2-rc.1` | Historical targeted fixes for the Workspace/Conversation boot cycle and provider enable/disable lifecycle respectively; see CHANGELOG. Not newly retested here. |
| `0.7.3` | `0.1.2-rc.1` | Known possible Workspace/Conversation activation cycle; fixed starting in `0.7.4`. |
| `0.7.2` and earlier | `0.1.2-rc.1` | Depend on the removed `dsh-client-runtime`; unsuitable for this Host line. This does not invalidate their original older-Host combinations. |

Do not infer a continuous supported range from isolated passing versions.

### Issue #9 follow-up (2026-09-25; plugin 0.9.3)

Plugin `0.9.3` carries both `schema` (legacy) and `create()` (new strict Typert). Client navigation prefers `uiWorkspace.openSession` and falls back to `sessions.open` on older Hosts; the selected new-generation Session comes from a unique `retainedBy.mainView`, failing closed on ambiguity. The official Workspace Browser is derived separately from exact rc.1, `0.1.6-alpha.2`, and `0.1.7-rc.2` source/SHA gates. The Host-resolved `dsh-agent` version selects exactly one authorized Slot tree; unknown generations retain the official provider. Managed rows keep Worktree status and suppress unsafe actions. **Builds and unit tests are not browser acceptance on a new Host.**

| Harness | Current status |
| --- | --- |
| `0.1.2-rc.1` | Pinned build/test baseline; new regression tests run on this line. |
| `0.1.5-rc.3` | npm `latest` at this check; no isolated Profile run, not claimed supported. |
| `0.1.6-alpha.2` | Matching official Browser is now source/SHA-gated, with strict-codec and new navigation/selection adaptations. Local build/source-seam tests pass; **no isolated Profile startup, render, creation or navigation smoke yet. No runtime compatibility claim.** |
| `0.1.7-rc.2` | Official Browser remains version/SHA-gated. A fresh isolated source-Host Profile installed twice without bypass, passed config smoke, and rendered in a real Web browser. A disposable Git Workspace exercised the Worktree switch, pre-session creation, draft transfer, managed-row status and selection after reload. **Without an API key, AI conversation and the full review/recovery/cleanup lifecycle remain untested; this is not a complete runtime compatibility claim.** |

The isolated development command is in [Local development](USAGE.md#本地开发). In rc.2, `sessions.create()` only catalogues an identity; an initial attempt borrowed an unretained binding and was safely rolled back. The controller now uses official `sessions.using()` through draft handoff and navigation, confirmed in the real browser. Alpha.2 still needs an independent Profile run, and AI conversation / Worktree lifecycle need an API-key-enabled test environment. Unknown upstream generations are not assigned a derived Browser.

### 0.2.0-rc.2 adaptation (2026-09-30; plugin 0.10.0)

Plugin `0.10.0` moves all DSH peers and dev dependencies to `0.2.0-rc.2` (exact), switches the official Workspace Browser derivation gate from rc.1 to 0.2.0-rc.2 (version/SHA-256), and retains the `0.1.6-alpha.2` and `0.1.7-rc.2` derivations; the runtime still selects exactly one derivation from the Host-resolved `dsh-agent` version. Fixed this round: the Web-boot deadlock caused by the `remote.directoryPicker` injection cycle, the `modern` flavor missing from the strict codec, and four derivation seams plus the `IconBranchOutlineRegular` icon naming aligned with 0.2.0.

| Check | Result |
| --- | --- |
| Isolated `DSH_HOME` + source Host (`dsh-v0.2.0-rc.2`) dev install (typecheck/build/pack/profile install) | Passed, repeated multiple times |
| Web boot | All entries activate (before the fix: 12 entries pending, plugin stuck loading) |
| Real Chromium (automation-driven) | Page render, Session creation, sidebar list |
| Worktree switch → confirm → pre-session creation | Worktree actually created, managed row carries the in-progress mark (`data-managed-worktree`), no render errors |
| Unit/type | Typecheck passes; 40 test files, 552 passed / 1 skipped |

**Not accepted (no complete runtime compatibility claim)**: real AI conversation with an API key; the full review/preview/delivery/rollback/recovery/cleanup lifecycle; Windows; npm-installed Host (source runner only this round); desktop. Plugin peers are pinned to exact `0.2.0-rc.2`: 0.1.x Hosts are not a 0.10.0 target; 0.1.x users stay on the 0.9.x plugin line (its 0.1.x support records above are unaffected by this section).

### 0.2.1-rc.2 adaptation (plugin 0.11.0; pre-release source compatibility validation)

Plugin `0.11.0` is published on npm, with DSH peers and dev dependencies pinned to exact `0.2.1-rc.2`. No Worktree registry, Review or Recovery data migration is required; historical compatibility records are unchanged.

The following records pre-release source compatibility validation while the package version was still `0.10.1`, not a new test run or full end-to-end acceptance of the final `0.11.0` published package. A fresh project-local isolated install passed typecheck, build, sidebar version/SHA gates, publish checks and all 43 test files: **607 passed / 1 skipped**, including **24 real Cordis Loader/Web registry lifecycle tests**. This round fixes official Provider recovery after live disable and dual Providers after failed replacement activation: explicit marker release, waiting for the disabled fiber, public `entry.init()` for disposed generations, and identity-guarded withdrawal of failed/disposed replacement references. Configuration is not persisted; startup remains non-blocking with timeout/in-flight guards.

**Source compatibility only:** during that validation, no DSH Profile was started or modified, and no `0.2.1-rc.2` browser, real AI, desktop or Windows end-to-end acceptance was performed. Earlier browser evidence does not accept the new source. The one skipped test is Windows-only long-path coverage. See the [exact commands and review handoff](compatibility/0.2.1-rc.2.md) and [machine-readable results](compatibility/0.2.1-rc.2-validation.json).

**Separate three current constraints:** (1) DSH dev dependencies are exact `0.2.1-rc.2`, with Cordis `4.0.5`, loader `1.0.6`, include `1.0.10` and schemastery `3.18.5`. (2) DSH peers, including locale, are exact `0.2.1-rc.2`; Cordis/loader peers are `~4.0.5` / `~1.0.6`. This does not prove every permitted patch version. The historical `0.9.3` caret/locale constraints above are not the current manifest; never install private Host singletons merely to suppress Profile peer warnings. (3) Current Browser sources are individually version/SHA-gated `0.2.1-rc.2`, `0.1.6-alpha.2` and `0.1.7-rc.2`. Host-resolved agent version selects one derivative; the new modern source is not reused on `0.2.0`, and unknown versions keep the official Provider. Keeping old derivations does not extend current peer support to old Hosts. Neither gate nor package selection proves browser acceptance. Historical working combinations are not withdrawn.

**Migration:** rc.1 of the 0.1.5 line uses Session V3; older Hosts cannot read upgraded logs. Back up the original environment and test with an isolated `DSH_HOME`/repository. Rollback requires original data, not just an older npm package. The 0.1.2-rc.1 line also removed the optional SQLite backend; export old data with the original version first. Record resolved packages rather than the CLI version alone: a caret may resolve a later RC. This run found no rc.2 mixing. Registry tags observed on 2026-09-11 were `latest=0.1.5-rc.1`, `next=0.1.5-rc.2`.

There is no established reason from this check to force working rc.1 users to downgrade, nor sufficient evidence to claim complete forward compatibility. See the [validation report](compatibility/2026-09-11.md) for limitations.
