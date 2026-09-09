# Worktree UI 开发说明

本文提供当前 UI 的源码入口、集成约束和验证方式。状态模型、权限边界与恢复语义见 [Worktree Console 架构](WORKTREE-CONSOLE-ARCHITECTURE.md)，产品操作见 [使用指南](USAGE.md)，发布流程见 [RELEASE.md](RELEASE.md)。

## 1. 入口与模块

| 入口 | 职责 |
| --- | --- |
| `src/client/console-remote/index.ts` | 实际 Client bundle 入口：mount 包内 Remote contribution、提供 adapter、注册 Workspace Sidebar 和会话 UI |
| `src/client/console-remote/adapter.ts` | 将 Gateway transport 结果与业务结果归一化为 `WorktreeConsoleOutcome<T>` |
| `src/client/index.tsx` | 注册 ToolView、Header、composer dock 和 pre-session UI，管理插件样式与本地化包装 |
| `src/client/pre-session/` | 新会话 Worktree 确认、创建和草稿交接 |
| `src/client/target-console/` | Session Target 状态、关联 Worktree Manager 与 Review dock |
| `src/client/review-console/` | 验收详情、Preflight、Delivery Proof 与恢复操作 |
| `src/client/workspace-sidebar/` | 官方 Workspace Browser 的 Managed Worktree 展示集成 |
| `src/console-contract.ts` | Host/Client 共享 DTO 与 adapter 契约 |
| `src/console-host/`、`src/console-remote/` | Host control plane、strict Remote descriptors、schemas 与 contributions |

## 2. Client 与 Host 通信

当前实现使用 Harness Typert Remote，不使用早期动态原型的 `harness.handle()/host.call()`：

```text
Client entry
→ ctx.remote.$mount(package-owned contribution)
→ remote.gitWorktree
→ createWorktreeConsoleRemoteAdapter(remote)
→ WorktreeConsoleAdapter
→ UI
```

Host contribution 位于 `src/console-remote/typert.ts`，Client contribution 位于 `src/console-remote/remote.ts`；两者使用包内 descriptors 和 strict schemas。当前 Host contribution 是手工声明，不应假设构建会自动生成新的 Remote 方法。

新增或调整 API 时，同步维护共享契约、Host control plane、Remote descriptors/schemas、Client adapter 与相关测试。预期业务失败返回 `WorktreeConsoleOutcome<T>`；transport failure 由 adapter 归一化。UI 不根据错误文案推断权限或恢复能力，也不通过传入路径或 owner ID 获得授权。

Remote mount 的 disposer 由 Client effect 管理。Workspace Sidebar 先注册，会话相关 UI 在具备 `toolViewInject` 服务的 child fiber 中注册；不要把会话依赖提升到顶层，造成 Workspace 与 Conversation 的启动循环。

## 3. UI 挂载与呈现

现有会话 UI 由公共 Slots 注册：

| Slot | 用途 |
| --- | --- |
| `tool.call.toolview` | `worktree_create` 与 `worktree_ready_for_review` 的调用卡片 |
| `conversation.input.left` | blank Local Session 的 Worktree 开关与确认流程 |
| `conversation.session.header.actions` | Target 状态与关联 Manager 入口 |
| `conversation.input.dock` | 当前 Worktree 的验收入口与操作 |

当前不注册 `conversation.view` Worktree 页签。Manager 通过 Header 打开，不另建重复的常驻工作台。

- UI 使用 Host facts 与 capability，不维护第二套持久生命周期。
- 新会话创建与草稿交接复用 `pre-session` controller 和标准 composer，不拦截私有 submit sink。
- 文案沿用 `src/client/i18n.tsx` 与 `src/i18n/` 的中英文目录，规则见 [i18n.md](i18n.md)。
- 样式沿用现有组件样式模块；`src/client/index.tsx` 通过 effect 插入带插件标识的 style，并在卸载时移除。
- Workspace Sidebar 是带版本及 SHA-256 门禁的官方组件派生集成。修改前阅读 [UPSTREAM.md](../src/client/workspace-sidebar/UPSTREAM.md)，保留上游结构、授权边界与许可证说明。

## 4. 构建与包配置

`package.json` 的 `dsh.client` 声明 Client 注入依赖，`exports["./client"]` 指向 `lib/client.js`。Host 和 Client 由同一个 npm 包发布，Host 挂载配置见 `cordis.patch.yml`。

`tsdown.config.ts` 从 `src/client/console-remote/index.ts` 构建 Client：

- CJS 格式，`platform: 'neutral'`，目标为 ES2022；
- 输出包装为 `window.__ModuleLoader__.load({ id, factory })`；
- React、Cordis、Client Store 与 UI Primitives 等平台模块保持 external，避免双实例；
- 通过 virtual module 在构建期嵌入受版本和哈希校验的官方 Workspace Client；
- TypeScript 编译与 Client bundling 由 `pnpm run build` 串联。

不要照搬旧原型的 bundle 配置或凭猜测增减平台依赖；以当前配置、上游契约和 `scripts/check-publish.mjs` 门禁为准。

## 5. 聚焦验证

根据改动选择对应测试，不要求每次执行所有命令。以下命令在已安装项目依赖后运行：

```bash
# Remote/契约变更
pnpm exec vitest run tests/console-contract.test.ts tests/console-host.test.ts tests/console-remote.test.ts

# 创建、Target 与 Review UI
pnpm exec vitest run tests/client-pre-session.test.tsx tests/client-target-console.test.tsx tests/client-review-console.test.tsx tests/client-toolview.test.tsx

# 本地化变更
pnpm exec vitest run tests/client-i18n.test.tsx tests/i18n-catalogs.test.ts

# 类型边界变更
pnpm run typecheck

# bundle、exports 或注入依赖变更
pnpm run build
pnpm run check:publish
pnpm exec vitest run tests/client-bundle.test.ts
```

Preflight、恢复和 Sidebar 另有对应的 `tests/client-*.test.*`，涉及这些行为时补充相关测试。Sidebar 上游升级还必须遵循 `UPSTREAM.md` 的兼容性验证要求。

实际 Harness 中检查：新会话开关与确认、Header/Manager、Review 卡与 dock、Workspace Sidebar、语言切换，以及插件启停后的清理。自动化测试不等同于真实浏览器验证；交付时应区分已执行与未执行的检查。完整发布门禁以 [RELEASE.md](RELEASE.md) 为准。
