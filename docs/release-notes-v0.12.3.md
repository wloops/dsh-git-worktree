# v0.12.3 — 延迟创建隔离目录与介绍改版

状态：已发布。npm `0.12.3` 为 latest（gitHead `5fbda7c014e606ee663cf4c70da32ad51c02abac`）；tag `v0.12.3` 与 [GitHub Release](https://github.com/wloops/dsh-git-worktree/releases/tag/v0.12.3) 已于 2026-11-10 创建。

## 本版目的

把已提交但尚未发布的能力与文档改进一起带上线：首条消息发送时延迟创建同会话隔离目录，以及按定稿文案重写的 README 与截图体系。

## 主要更新

- **延迟创建隔离目录**：持久化 Worktree 选择，在原生消息执行前创建并绑定有效工作目录；创建失败时挂起消息并支持重试，避免失败静默回退 Local。适配同会话权限核验、交付后下一轮及旧 Host 兼容，并补充消息门禁、异步选择竞争与真实 Git 生命周期测试。
- **README 与介绍改版**：中英文首屏移除维护者安装策略说明，采用用户视角定稿简介；版本表与安装命令更新至 `0.12.3`；历史验证记录收进兼容性文档；核心能力表述去术语化。
- **截图全量换新**：侧边栏聚合与准备验收替换为新图，新增冲突与恢复截图；移除创建 Worktree 截图与四张未引用旧图，同步 USAGE 中英文与 `screenshots.json`。
- **插件展示文案**：`package.json` description 改为定稿英文，GitHub 仓库 About 更新为定稿中文简介；npm 页面文案随本版发布生效（0.12.2 页面仍显示旧文案，已发布版本不可修改）。
- **发布门禁修复**：`check-publish` 方法面清单补齐 `deferredWorktree`，修复该功能提交后门禁在基线即失败的漂移。

## 兼容与使用说明

无数据迁移、无破坏性变更，升级路径与 `0.12.2` 相同。DSH peers 与构建基线保持 `>=0.2.1-rc.2 || 0.2.2-rc.1`，运行时 singleton 仍由宿主提供。延迟创建功能失败时挂起消息并可重试，不改变既有 Worktree 交付状态模型；旧 Host 保持既有兼容路径。

开发启动方式不变：`pnpm run dev:dsh` 无参数直接安装并启动常规 Web UI；显式 `--harness <path>` 在安装前检查源码客户端产物。

## 验证与未验证范围

本轮自动化验证结果见下方发布记录。既有证据包括延迟创建功能自身的消息门禁、异步选择竞争与真实 Git 生命周期测试，以及全量串行测试、来源门禁、构建与实际打包核验。

尚未完成真实 `0.2.2-rc.1` Host／Cordis 4.1／Loader 1.1 的全流程、desktop、AI、Windows 验收；README 新截图与 npm 页面文案发布后的实际展示未实测。完整原生聚合仍缺官方公开投影接口，见 [长期集成说明](SIDEBAR-NATIVE-INTEGRATION.md)。

## 发布记录

- 依赖安装（frozen lockfile）、typecheck、`check:sidebar-version`、build、`check:publish`（24 方法面）全部通过。
- 全量 `pnpm test`（串行）：**52 个测试文件通过，717 passed / 1 skipped**，约 710 秒；较 0.12.2 的 50 文件 / 704 passed 新增延迟创建功能的测试。
- 实际 `npm pack --ignore-scripts --json`：版本 `0.12.3`，262 个文件，压缩大小 812,066 字节，shasum `73859387829207ef3a40e0a0dab26571a8f2f259`；已核验 `lib/client.js`、`cordis.patch.yml`、`NOTICE`、`locale/en.json`、`locale/zh.json`、`assets/icon.svg`、含 0.12.3 条目的 `CHANGELOG.md`。发行说明只进 Git 仓库，不入 npm 包（`files` 仅含 `docs/i18n.md`）。
- `git diff --check` 通过。
- 发布结果（2026-11-10）：clean Local 发布门禁通过后推送，`master` 与 npm gitHead 均为 `5fbda7c`；tag `v0.12.3`、GitHub Release、npm publish 已完成，npm latest 即本版。发布后真实安装未做。
