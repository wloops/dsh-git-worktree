# Harness compatibility / Harness 兼容性

[中文](#中文) · [English](#english)

## 中文

**兼容性描述的是插件版本与 Harness 运行环境的组合，不是“只有最新 DSH 才能用”。** 新增一个版本的测试记录不会撤销旧组合的支持；未验证也不等于不兼容。

### 验证矩阵（2026-09-11）

| 插件 | Harness | 证据与范围 |
| --- | --- | --- |
| `0.8.0` | `0.1.2-rc.1` | 当前开发/构建基线。typecheck、build、30 个测试文件通过（431 passed、2 skipped），含 Session Target、Review、Recovery、Local 写入保护回归。本轮未重做此组合的真实浏览器全流程。 |
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

### 三种版本约束不要混淆

1. **开发基线**：运行时接口及大多数开发依赖仍以 `0.1.2-rc.1` 为基线；另用两个别名开发依赖固定 alpha/rc.2 的官方 Browser 源码用于构建门禁，不把它们作为发布包的 Host singleton。
2. **安装声明**：多数 DSH peer 为 `^0.1.2-rc.1`，locale peer 精确接受 `0.1.2-rc.1 || 0.1.7-rc.2`（经两版契约核对，不包含其他预发布版）。按通常的 npm semver 规则，该 caret 不自动包含不同核心版本的 `0.1.5-rc.1` 预发布版。不要把“能运行”说成“peer 已声明支持”。官方 Profile 使用 `autoInstallPeers: false` 并由 Host 提供运行时；Profile 单独执行 peer check 会报告缺失 Host peers，不等于已发生运行时故障。不要为消除警告而在 Profile 内补装另一套 DSH singleton。
3. **Workspace 派生**：`0.9.3` 的 Client bundle 含 rc.1、alpha.2、rc.2 三个经过版本/SHA-256 门禁的官方来源，只在 Host 包版本命中时注册相应 Browser；源码门禁和 Host 包识别都不是端到端兼容证明。

只扩展了已核对的 locale 精确版本；Profile `peers check` 仍可报告 Host 提供的多个 peer 缺失，不等于 locale 版本冲突或运行时失败。完整支持声明要等未覆盖的生命周期验收后再定。

### 升级与回退

- `0.1.5-rc.1` 使用 Session V3 数据格式；不要用旧 Host 读取升级后的新日志。测试新版本请使用隔离 `DSH_HOME` 和测试仓库；迁移前备份原环境，回退时恢复原数据而不是只降级 npm 包。
- `0.1.2-rc.1` 移除了可选 SQLite Session 后端，旧数据应先用原版本导出。
- CLI 版本不等于完整 Profile 包版本。记录实际解析的 DSH 包；例如 `^0.1.5-rc.1` 可以解析到同核心版本的后续 RC。本轮安装结果未混入 rc.2。
- 2026-09-11 查询官方 npm：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`。这些是本轮时间点的记录，不是永久更新承诺。

本轮没有足够证据要求已经正常使用 `0.1.5-rc.1` 的用户降级，也没有足够证据宣布所有新版本完全兼容。完整检测证据与限制见 [2026-09-11 检测报告](compatibility/2026-09-11.md)。

## English

**Compatibility belongs to a plugin/Host combination, not to “the newest DSH only.”** Testing a newer Host does not withdraw older support; untested does not mean incompatible.

| Plugin | Harness | Evidence and scope |
| --- | --- | --- |
| `0.8.0` | `0.1.2-rc.1` | Development/build baseline. Typecheck, build and 30 test files passed (431 passed, 2 skipped), including Session Target, Review, Recovery and Local write-protection regressions. No fresh browser end-to-end run for this combination in this check. |
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

**Separate three constraints:** runtime interfaces and most development dependencies retain the reproducible rc.1 baseline, with two aliased build-only official Browser sources pinned to alpha.2 and rc.2; most DSH peers declare `^0.1.2-rc.1` while locale precisely accepts `0.1.2-rc.1 || 0.1.7-rc.2` after contract checks; the `0.9.3` Client bundle embeds three individually version/hash-gated Browser sources and uses the Host-resolved agent package version to select only one. The caret does not normally admit a different-core `0.1.5-rc.1` prerelease. A runtime success is not peer-declared support. Official Profiles disable automatic peer installation and borrow Host runtime packages; never add private Host singletons just to silence a peer warning. Profile `peers check` still reports several Host-provided missing peers; this is not a locale version conflict or proof of runtime failure. Neither a hash gate nor package-version selection proves end-to-end forward compatibility.

**Migration:** rc.1 of the 0.1.5 line uses Session V3; older Hosts cannot read upgraded logs. Back up the original environment and test with an isolated `DSH_HOME`/repository. Rollback requires original data, not just an older npm package. The 0.1.2-rc.1 line also removed the optional SQLite backend; export old data with the original version first. Record resolved packages rather than the CLI version alone: a caret may resolve a later RC. This run found no rc.2 mixing. Registry tags observed on 2026-09-11 were `latest=0.1.5-rc.1`, `next=0.1.5-rc.2`.

There is no established reason from this check to force working rc.1 users to downgrade, nor sufficient evidence to claim complete forward compatibility. See the [validation report](compatibility/2026-09-11.md) for limitations.
