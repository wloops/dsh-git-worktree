# v0.12.2 — DSH 0.2.2 侧栏适配与开发体验修复

状态：已发布。npm `0.12.2`（gitHead `f07d2087c7edd9b77c04a6c54553b27ce31958df`，与当时的 `origin/master` 一致）；tag `v0.12.2` 与 [GitHub Release](https://github.com/wloops/dsh-git-worktree/releases/tag/v0.12.2) 已创建。

## 本版目的

修复 DSH `0.2.2-rc.1` 下 Worktree 侧栏未聚合，以及开发版安装后被临时测试仓库检查、未构建 Harness 客户端阻断的问题；补齐插件列表展示资源。

## 主要更新

- **恢复新版聚合**：为 `0.2.2-rc.1` 提供独立、精确版本与 SHA-256 校验的官方列表派生，恢复托管会话归入原项目及身份、状态标记。保留既有 rc.2、rc.5、alpha、next 路径。
- **保留官方交互**：同步结构化右键菜单、资源权限、会话 ID 搜索、手动排序、选择恢复、路径悬浮信息及扩展槽。托管会话保留置顶、重命名、复制 ID、归档；fork、新建与 Workspace 管理仍有所有权保护，草稿选项完整透传。
- **渐进式原生集成**：未知 Host 不接管官方 Provider，按公共行尾／悬浮槽位提供 Worktree 标记；共享拓扑读取合并刷新，拒绝过期及卸载后响应，失败只撤回标记。完整跨工作区聚合仍使用已知版本派生，不宣称已移除版本白名单。
- **开发启动**：`pnpm run dev:dsh` 不再强制创建或验证临时 Git fixture，不改写遗留目录。显式 `--harness` 在安装前检查 CLI、tsx、源码 pnpm 和官方 Web 客户端产物；缺失时报具体文件及构建指引，不先安装再失败，不静默切换运行时。
- **插件列表**：名称统一为 `Git Worktree`，简介按 DSH 界面语言选择中英文，新增专属 SVG 分支图标。正式包与开发快照均携带 locale 和图标。

## 兼容与使用说明

DSH peers 显式包含 `0.2.2-rc.1`；Cordis 4.1／Loader 1.1 声明为允许的运行时，singleton 仍由宿主提供。构建与自动化测试依赖基线仍是 DSH `0.2.1-rc.2`、Cordis 4.0.5／Loader 1.0.6；允许安装不等于已完成实机验收。

从插件 Local Checkout 明确选择相邻 Harness 源码（不需要 `--repo`）：

```bash
pnpm run dev:dsh -- --harness ../deepseek-harness
```

指定路径不会自动构建 Harness。若提示客户端产物缺失，请先按该源码仓库说明完成构建。预检验证文件存在，不验证产物新鲜程度或完整运行时兼容。默认工作区仍由 DSH 管理；`DSH_HOME` 隔离和显式 `--repo` 保持可选。

已有正式安装升级前建议先使用 scratch Profile 检查；开发快照需要重新安装才能更新简介和图标。本版不改变 Workspace 持久成员关系或 Worktree 交付状态模型。

## 验证与未验证范围

本轮自动化验证结果见下方发布准备记录。既有证据包括精确来源和派生语义测试、实际构建 Browser 的 jsdom 聚合及菜单、CSS 归属、Loader 生命周期、原生标记竞态、开发启动预检、实际 tarball 与 staging 资源检查。用户截图确认中文简介与图标可显示；统一英文名称之后尚无单独实机确认。

尚未完成真实 `0.2.2-rc.1` Host／Cordis 4.1／Loader 1.1 的全流程、菜单键盘／焦点、desktop、AI、Windows 验收。Chromium 假数据静态行检查及进程 mock 不能代替上述验证。完整原生聚合缺官方公开投影接口，详细证据见 [长期集成说明](SIDEBAR-NATIVE-INTEGRATION.md)；未向官方提交 issue 或 PR。

## 发布准备记录

- npm 查询：当前 latest 为 `0.12.1`，`0.12.2` 尚未列入已发布版本（2026-11-08）；正式发布前须复查。
- 版本已更新为 `0.12.2`。依赖未变化，pnpm lockfile 不记录根包版本，无需人为修改。
- 自动化门禁：typecheck、build、check:sidebar-version、check:publish 通过；完整测试 50 个文件通过，704 passed / 1 skipped。首次全量调用因工具 600 秒等待上限中断；随后通过可见终端完整重跑成功（约 632 秒），不将第一次中断计为测试通过。
- 实际 `npm pack --ignore-scripts --json`：版本 `0.12.2`，256 个文件，压缩大小 802,903 字节；已核验 `lib/client.js`、patch、NOTICE、`locale/en.json`、`locale/zh.json`、`assets/icon.svg` 和包级 icon/locale exports。开发快照资源复制回归包含在全量测试中。打包基于先前已完成的同快照构建，未执行 publish。
- （截至准备阶段 2026-11-08）尚未执行 clean Local 发布门禁、release commit CI、远程 tag、GitHub Release、npm publish、发布后真实安装；这些已在后续发布步骤中完成，见下方发布结果。

## 发布结果

- release 提交链 `60d0579` → `c5ac08f` → `f07d208` 已推送 `origin/master`；`c5ac08f` 的 GitHub CI 通过（run 42501128631）。
- tag `v0.12.2` 与 GitHub Release 已创建：https://github.com/wloops/dsh-git-worktree/releases/tag/v0.12.2
- npm `0.12.2` 已发布，gitHead `f07d2087c7edd9b77c04a6c54553b27ce31958df`（发布时 `prepublishOnly` 重跑构建与全量测试通过）。
- 真实 scratch Profile 安装验收与实机验证缺口仍见上方「验证与未验证范围」。
