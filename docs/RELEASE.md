# Release checklist（发布清单）

发布不能马虎。**每一步都不能跳过**，尤其是第 5 步：发布只是开始，装得上、挂得上才算数。

## 流程

1. **构建 + 门禁**（本地，必须全绿）
   ```sh
   pnpm run build
   pnpm run check:publish
   ```
   `check-publish` 断言：
   - `package.json` 声明 `dsh.bundle.patch` 且文件存在（否则 `dsh plugin add` 只装普通依赖，插件不挂载）
   - `cordis.patch.yml` 在 `files` 里（否则 tarball 不带它）
   - patch 含 `- insert:` 且插入本包名的行
   - `lib/index.js` 同时命名导出 `apply` 与 `inject`（Loader 以空注入列表挂载会在首次 `ctx.<service>` 崩溃）
   - **工作区与 HEAD 一致**（git 安装从已提交源码构建，未提交的修复会让 npm 好、git 坏）

2. **测试**
   ```sh
   pnpm test        # 48 passed / 2 skipped
   ```

3. **版本 + tag**
   ```sh
   # bump version → commit → push master → tag → push tag
   git tag v<版本> && git push origin master && git push origin v<版本>
   ```

4. **发布**（`prepublishOnly` 自动重跑 1 + 2）
   ```sh
   npm publish
   ```

5. **发布后实测**（最容易省、最容易出事的一步）
   - npm 路径：`dsh plugin --profile <scratch> add dsh-git-worktree@<版本>`
     → 无 `declares no dsh.bundle` 警告；`<scratch>/package.json` 的 `dsh.profile.bundles` 含本包
   - git 路径：`dsh plugin --profile <scratch> add github:wloops/dsh-git-worktree#v<版本>`
     → 首次会被 pnpm 的 `allowBuilds` 拦 prepare 构建，按提示加 key 后重跑
     → 安装产物的 `lib/index.js` 含 `export const inject` / `export function apply`
   - boot 挂载：`dsh --profile <scratch>` 启动后无错误输出、进程存活（崩溃会在数秒内带栈退出）

6. **全部通过后**，再把正式 profile（如 `web`）更新到新版本。

## 历史教训（为什么有这些步骤）

| 版本 | 漏掉的验证 | 后果 |
| --- | --- | --- |
| 0.1.0 | 无 bundle 声明 / 无 patch 文件 | 装上后 DSH 无任何反应（评审当场拒收） |
| 0.1.1 | `inject` 未作为命名导出 | boot 时 `cannot get property "tools" without inject` 崩溃 |
| 0.1.2 (git 路径) | 修复未提交，只验证了工作区 | npm tarball 正常、git 源构建产物损坏——端到端实测才抓到 |
