# 官方侧栏长期集成：已落实部分与剩余接口缺口

## 目标与当前状态

目标是复用 **Host 实际安装并管理的官方列表**，不复制官方源码、不逐版本维护 Browser factory，同时保持 Worktree 跨工作区聚合、会话身份状态与所有权不变量。

目前是分阶段迁移，不是已经完成原生聚合：

- 已识别且已有源码回归的 Host，继续走现有精确派生，保留聚合和常驻 tag，避免以架构调整为由撤掉功能。
- 未识别的 Host 保留官方 Provider，通过公共 Slot 声明生命周期注入行尾标记与悬浮信息。不再因为“不在派生白名单”而连标记也失去。该原生扩展不检查 DSH 版本、不更换 `uiWorkspace`、不写 Workspace Controller，不创建 Session binding，也不改官方菜单和权限。
- 标记拓扑由一个插件级数据源共享，列表更新和验收事件触发刷新；并发刷新合并，过期响应与卸载后的响应不发布，读取失败只撤掉标记，不撤掉官方行。
- 行尾扩展遵循官方展示约束：悬停、聚焦或菜单打开时可能隐藏；`working` 保留分支图标而不加文字，完整状态在悬浮区域。它不是标题旁常驻 tag 的等价替代。
- `model.ts` 的聚合函数不依赖 Browser 版本；任务状态选择逻辑由派生聚合和原生装饰共用。尚未获得公开投影接入点前，不把模型结果注入全局数据源。

## 已核对的官方 0.2.2-rc.1 事实

本结论来自发布包的 JS 与类型声明，不依赖页面外观推断。

### 1. 可直接使用的公共接口

`dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts`：

- `sidebar.session.row.leading`：idle 时使用的 16px 位置，活跃状态会被官方状态点替换。
- `sidebar.session.row.trailing`：时间后、置顶前的非交互装饰，遵循官方 hover/focus/menu 隐藏策略。
- `sidebar.session.row.hover`：悬浮卡片的扩展区。
- `sidebar.workspaces.session.row.action` 与外部菜单 Slot；内置菜单使用 `contextMenus`。

`slots.inject()` 等待声明并管理声明生命周期；扩展只注册自己的贡献，不重新声明官方 children。

### 2. 不能用 shadow 冒充透明装饰器

`dsh-client-ui-slots/lib/types/index.d.ts` 的 `ChildrenDecl`、`SlotCore.register`、`StoredEntry` 规定：

- child declaration 同时确定唯一授权 entry；
- shadow entry 不继承原 entry 的 `renderSlot` 授权；
- 复制 child declarations 会因重复声明失败；
- 官方 entry 销毁时会递归清除其 children；保留旧 renderer 不能恢复授权。

因此不采用修改 `StoredEntry.component`、伪造 `renderSlot`、劫持全局 registry 或 DOM 移动来实现聚合。

### 3. 动态 import 不能替代唯一官方实例接入

`dsh-client-modules` 的 Host `processOne()` 跳过 disabled 或没有 fiber 的 entry。`dsh.client.inject`、`external` 是已有 graph row 的依赖，不会让被禁用的官方包重新成为可导入 row。

官方启用时 `ctx.modules.import()` 能读到模块 exports，但再次执行 `apply(proxy)` 会第二次创建 `uiWorkspace`，并重复菜单、快捷键和 Slot 注册。官方包没有独立导出的运行时 Browser 组件。缓存残留不是受支持的分发契约。

## 最小上游能力建议（尚未提交）

优先建议由 **Workspace UI 自己提供列表投影和身份展示契约**，而非扩大通用 Slot 权限。下列描述是提案要求，不是已经存在的 API，也未在插件中虚构并调用：

1. **只作用于 Workspace Browser 的视图投影注册**：输入权威 sessions/workspaces 快照，输出展示分组、可见成员与会话装饰。不得改变 Controller、Session cwd、持久 Workspace membership、权限或导航目标。
2. **明确展示与身份分离**：会话可以展示在原项目下，但 open/fork/rename/archive 的捕获目标仍是原 Session ID；排序/拖动不得把虚拟分组写回真实成员归属。普通 Local 会话行为保持不变。
3. **专用行身份/tag seat**：不占用官方运行状态点，容纳 Worktree 图标与短状态 tag，明确截断、归档、触屏、悬停、搜索结果及可访问性行为。
4. **统一动作保护**：投影可声明哪些行不允许 fork、移动或在其底层 Workspace 新建；菜单、快捷键及服务路径仍由同一执行保护验证，不以隐藏按钮作为授权。
5. **生命周期和冲突契约**：注册可撤销，卸载/HMR 自动恢复；多插件有顺序或冲突规则，歧义不隐藏会话；未知能力时保留官方列表。

可讨论的另一条路是 Host 模块“可分发但不自动激活”，使插件动态导入当前官方 apply 并唯一激活；但它扩大模块生命周期改造范围，且不能自动解决动作保护与稳定标签，因此不是首选。

## 验收要求

- 新的未知 Host 不需要新增版本分支即可使用其声明的原生装饰槽；缺失槽时官方列表保持正常。
- 普通会话无标记，owner 状态随拓扑变化；失败、卸载、声明撤销、重挂载与过期响应正确处理。
- 完整聚合迁移必须证明相同仓库 sibling Worktree 归入原项目、歧义成员不丢失、归档和当前 blank 不误隐藏、导航身份不变、动作不能绕过保护。
- 在官方提供投影契约前，这一项保持未完成；已有精确派生不是原生迁移验收证据。

本轮不对外创建 issue/PR。上述事实和最小提案可供下一步判断；确认上游方案后，才能删除内嵌来源、Host Provider election 和版本路由，而不是先删掉聚合功能。
