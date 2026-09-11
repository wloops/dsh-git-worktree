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

### 三种版本约束不要混淆

1. **开发基线**：开发依赖和锁文件固定 `0.1.2-rc.1`，用于可重复构建与回归；不是对所有较新 Host 的运行时拒绝。
2. **安装声明**：多数 DSH peer 为 `^0.1.2-rc.1`，locale peer 为精确 `0.1.2-rc.1`。按通常的 npm semver 规则，该 caret 不自动包含不同核心版本的 `0.1.5-rc.1` 预发布版。不要把“能运行”说成“peer 已声明支持”。官方 Profile 使用 `autoInstallPeers: false` 并由 Host 提供运行时；Profile 单独执行 peer check 会报告缺失 Host peers，不等于已发生运行时故障。不要为消除警告而在 Profile 内补装另一套 DSH singleton。
3. **Workspace 派生**：发布的 Client bundle 包含从官方 `ui-workspace@0.1.2-rc.1` 派生的实现。构建时 version/SHA-256 校验验证的是这个来源，不是对运行中 Host 版本的探测，也不证明新版 Host 全兼容。不能仅因 Host 升级而修改 SHA 或放宽校验。

本轮没有更改以上约束。只有新旧组合均通过必要验证后，才考虑扩展 peer 声明或调整派生来源。

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

**Separate three constraints:** development dependencies/lockfile pin the reproducible `0.1.2-rc.1` baseline; most DSH peers declare `^0.1.2-rc.1` and locale declares exact rc.1; the Client bundle derives the official rc.1 Workspace source with a build-time version/hash gate. The caret does not normally admit the different-core `0.1.5-rc.1` prerelease. Runtime success is not the same as peer-declared support. Official Profiles disable automatic peer installation and borrow Host runtime packages, so a Profile-only peer check reports missing Host peers; do not install duplicate singletons merely to silence it. The source hash gate is not a runtime Host-version check or proof of forward compatibility. None of these constraints were changed in this check.

**Migration:** rc.1 of the 0.1.5 line uses Session V3; older Hosts cannot read upgraded logs. Back up the original environment and test with an isolated `DSH_HOME`/repository. Rollback requires original data, not just an older npm package. The 0.1.2-rc.1 line also removed the optional SQLite backend; export old data with the original version first. Record resolved packages rather than the CLI version alone: a caret may resolve a later RC. This run found no rc.2 mixing. Registry tags observed on 2026-09-11 were `latest=0.1.5-rc.1`, `next=0.1.5-rc.2`.

There is no established reason from this check to force working rc.1 users to downgrade, nor sufficient evidence to claim complete forward compatibility. See the [validation report](compatibility/2026-09-11.md) for limitations.
