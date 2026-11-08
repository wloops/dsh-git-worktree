import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { materializeWorkspaceFactory } from './workspace-sidebar-upstream-next.mjs'
import { ownWorkspaceStyles } from './workspace-sidebar-resources.mjs'

export const V022_WORKSPACE_VERSION = '0.2.2-rc.1'
export const V022_WORKSPACE_SHA256 = 'bb31f7870381f737b2cb45db4c7911a08a4949856bc86b648a10d3e85a3e9f89'
export const V022_WORKSPACE_VIRTUAL_ID = 'virtual:dsh-official-workspace-client-022'
export const RESOLVED_V022_WORKSPACE_VIRTUAL_ID = `\0${V022_WORKSPACE_VIRTUAL_ID}`

export function verifyV022WorkspaceClient(manifest, source) {
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-workspace' || manifest.version !== V022_WORKSPACE_VERSION) {
    throw new Error(`Unsupported official Workspace source ${manifest.name}@${manifest.version}`)
  }
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== V022_WORKSPACE_SHA256) throw new Error(`Official Workspace Client 0.2.2 hash drifted: ${digest}`)
  return source
}

export function readV022WorkspaceClient() {
  const require = createRequire(import.meta.url)
  const name = '@deepseek-ai/dsh-client-ui-workspace-022'
  return verifyV022WorkspaceClient(JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')),
    readFileSync(require.resolve(`${name}/client`), 'utf8'))
}

// Only projection and ownership seams change. Context menus, access hooks,
// search, navigation, row statuses and ambient extension seats stay upstream.
export function decorateV022WorkspaceClient(source) {
  let derived = source
  const replace = (needle, replacement) => {
    if (!derived.includes(needle) || derived.indexOf(needle) !== derived.lastIndexOf(needle)) {
      throw new Error(`Unable to derive official Workspace Client 0.2.2: expected one stable source seam: ${needle}`)
    }
    derived = derived.replace(needle, replacement)
  }
  replace('super(ctx, "uiWorkspace");', 'super(ctx, "uiWorkspace");\n\t\t\t\tthis.managedWorktreeGuard = ctx.get("__dshGitWorktreeManagedGuard");')
  replace('async forkSession(sessionId, onCreated, options) {', 'async forkSession(sessionId, onCreated, options) {\n\t\t\t\tif (this.managedWorktreeGuard.blockSession(sessionId)) throw new Error("managed Session must be changed through its Worktree owner");')
  replace('const target = workspaceId ?? currentWorkspaceId ?? recent;', 'const target = workspaceId ?? currentWorkspaceId ?? recent;\n\t\t\t\tif (target !== void 0 && this.managedWorktreeGuard.blockWorkspace(target)) return;')
  replace('updatedAt: s.updatedAt,', 'updatedAt: s.updatedAt,\n\t\t\t\t__dshGitWorktree: s.__dshGitWorktree,')
  replace('workspace: labelOf(summary),', 'workspace: labelOf(summary),\n\t\t\t\t\t\t__dshGitWorktree: summary.__dshGitWorktree,')
  replace('const draggable = drag !== void 0 && reorderable && !row.blank && !row.archived;', 'const draggable = drag !== void 0 && reorderable && !row.blank && !row.archived && node.__dshGitWorktree === void 0;')
  replace('function SessionHoverContent({ node, cwd, now, renderSlot, t }) {', `function ManagedWorktreeIdentity({ node, hover = false }) {
    const decoration = node.__dshGitWorktree;
    if (decoration?.kind !== "managed-worktree") return null;
    return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
      (0, react_jsx_runtime.jsx)("span", {
        className: hover ? Rows_module_css_default.hoverStatus : "dsh-git-worktree-sidebar-icon",
        "data-worktree-state": decoration.state,
        "aria-label": decoration.label,
        children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {})
      }), (hover || decoration.state !== "working") && (0, react_jsx_runtime.jsx)("span", {
        className: hover ? void 0 : "dsh-git-worktree-sidebar-badge",
        "data-worktree-state": decoration.state, children: decoration.label
      })
    ] });
  }
\t\tfunction SessionHoverContent({ node, cwd, now, renderSlot, t }) {`)
  replace('renderSlot("sidebar.session.row.hover", { sessionId: node.id }),', '(0, react_jsx_runtime.jsx)(ManagedWorktreeIdentity, { node, hover: true }),\n\t\t\t\t\trenderSlot("sidebar.session.row.hover", { sessionId: node.id }),')
  replace('"data-row-key": `session:${node.id}`,', '"data-row-key": `session:${node.id}`,\n\t\t\t\t\t...node.__dshGitWorktree === void 0 ? {} : { "data-managed-worktree": "true" },')
  replace('\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tref: titleRef,', '\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(ManagedWorktreeIdentity, { node }),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tref: titleRef,')
  replace('className: clsx(Rows_module_css_default.searchResultRow, selected && Rows_module_css_default.selected, result.archived && Rows_module_css_default.archived),', 'className: clsx(Rows_module_css_default.searchResultRow, selected && Rows_module_css_default.selected, result.archived && Rows_module_css_default.archived),\n\t\t\t\t...result.__dshGitWorktree === void 0 ? {} : { "data-managed-worktree": "true" },')
  replace('\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.searchResultTitle,', '\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(ManagedWorktreeIdentity, { node: result }),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.searchResultTitle,')
  return derived
}

export function materializeV022WorkspaceClientModule() {
  return materializeWorkspaceFactory(ownWorkspaceStyles(decorateV022WorkspaceClient(readV022WorkspaceClient()), V022_WORKSPACE_VERSION, 3))
}
