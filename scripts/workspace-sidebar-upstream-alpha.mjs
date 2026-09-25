import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { materializeWorkspaceFactory } from './workspace-sidebar-upstream-next.mjs'

export const ALPHA_WORKSPACE_VERSION = '0.1.6-alpha.2'
export const ALPHA_WORKSPACE_SHA256 = 'cec5cdfc90b0732356b678e84ee00949d26b8c1b70d4dd5fcc20660d7267e448'
export const ALPHA_WORKSPACE_VIRTUAL_ID = 'virtual:dsh-official-workspace-client-alpha'
export const RESOLVED_ALPHA_WORKSPACE_VIRTUAL_ID = `\0${ALPHA_WORKSPACE_VIRTUAL_ID}`

export function readAlphaWorkspaceClient() {
  const require = createRequire(import.meta.url)
  const packageName = '@deepseek-ai/dsh-client-ui-workspace-alpha'
  const packageJson = JSON.parse(readFileSync(require.resolve(`${packageName}/package.json`), 'utf8'))
  if (packageJson.name !== '@deepseek-ai/dsh-client-ui-workspace' || packageJson.version !== ALPHA_WORKSPACE_VERSION) {
    throw new Error(`Unsupported official Workspace source ${packageJson.name}@${packageJson.version}`)
  }
  const source = readFileSync(require.resolve(`${packageName}/client`), 'utf8')
  const hash = createHash('sha256').update(source).digest('hex')
  if (hash !== ALPHA_WORKSPACE_SHA256) throw new Error(`Official Workspace Client hash drifted: ${hash}`)
  return source
}

function once(source, needle, replacement, label) {
  const at = source.indexOf(needle)
  if (at < 0 || at !== source.lastIndexOf(needle)) {
    throw new Error(`Cannot derive official Workspace ${ALPHA_WORKSPACE_VERSION} ${label}: expected one source seam`)
  }
  return source.slice(0, at) + replacement + source.slice(at + needle.length)
}

/** Keep the official alpha Client while disabling unsafe managed-owner row mutations. */
export function decorateAlphaWorkspaceClient(source) {
  let derived = source
  const replace = (needle, replacement, label) => { derived = once(derived, needle, replacement, label) }
  replace(
    '\t\t\t\tgroups.push(buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members));',
    '\t\t\t\tconst group = buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members);\n\t\t\t\tif (workspace.__dshGitWorktreeProtected === true) group.__dshGitWorktreeProtected = true;\n\t\t\t\tgroups.push(group);',
    'protected workspace group',
  )
  replace(
    '\t\t\t\t\tlabel: g.label,\n\t\t\t\t\tsessionCount: g.sessions.length,',
    '\t\t\t\t\tlabel: g.label,\n\t\t\t\t\t...g.__dshGitWorktreeProtected === true ? { __dshGitWorktreeProtected: true } : {},\n\t\t\t\t\tsessionCount: g.sessions.length,',
    'protected workspace row',
  )
  replace(
    '\t\t\tasync forkSession(sessionId) {\n\t\t\t\tconst navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal]);',
    '\t\t\tasync forkSession(sessionId) {\n\t\t\t\tif (this.ctx.get("__dshGitWorktreeManagedGuard").blockSession(sessionId)) throw new Error("managed Session must be changed through its Worktree owner");\n\t\t\t\tconst navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal]);',
    'managed Session fork',
  )
  replace(
    '\t\t\tasync archiveSession(sessionId) {\n\t\t\t\tawait this.workspaces.archiveSession(sessionId);',
    '\t\t\tasync archiveSession(sessionId) {\n\t\t\t\tif (this.ctx.get("__dshGitWorktreeManagedGuard").blockSession(sessionId)) throw new Error("managed Session must be changed through its Worktree owner");\n\t\t\t\tawait this.workspaces.archiveSession(sessionId);',
    'managed Session archive',
  )
  replace(
    '\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? recent;\n\t\t\t\tif (target === void 0) {',
    '\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? recent;\n\t\t\t\tif (target !== void 0 && this.ctx.get("__dshGitWorktreeManagedGuard").blockWorkspace(target)) return;\n\t\t\t\tif (target === void 0) {',
    'managed Workspace new Session shortcut',
  )
  replace(
    '\t\t\t\trenameSession: async (sessionId, title) => {\n\t\t\t\t\tconst result = await sessions.using(',
    '\t\t\t\trenameSession: async (sessionId, title) => {\n\t\t\t\t\tif (ctx.get("__dshGitWorktreeManagedGuard").blockSession(sessionId)) throw new Error("managed Session must be changed through its Worktree owner");\n\t\t\t\t\tconst result = await sessions.using(',
    'managed Session rename',
  )
  replace(
    '\t\t\t\tupdatedAt: s.updatedAt,\n\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction }',
    '\t\t\t\tupdatedAt: s.updatedAt,\n\t\t\t\t__dshGitWorktree: s.__dshGitWorktree,\n\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction }',
    'managed Session metadata',
  )
  replace(
    '\t\tfunction ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, t }) {\n\t\t\tconst row = group;',
    '\t\tfunction ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, t }) {\n\t\t\tconst row = group;\n\t\t\tconst protectedManagedWorkspace = row.__dshGitWorktreeProtected === true;',
    'managed Workspace row guard',
  )
  replace('\t\t\t\tdraggable: drag !== void 0,', '\t\t\t\tdraggable: drag !== void 0 && !protectedManagedWorkspace,', 'managed Workspace drag')
  replace('\t\t\t\tonDragStart: drag === void 0 ? void 0 : (e) => {', '\t\t\t\tonDragStart: protectedManagedWorkspace || drag === void 0 ? void 0 : (e) => {', 'managed Workspace drag start')
  replace('\t\t\t\t\t\tchildren: [actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {', '\t\t\t\t\t\tchildren: [!protectedManagedWorkspace && actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {', 'managed Workspace menu')
  replace('\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.iconButton,\n\t\t\t\t\t\t\t"aria-label": t("actions.newSession.aria", { name: label }),', '\t\t\t\t\t\t}), !protectedManagedWorkspace && (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\t\t\ttype: "button",\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.iconButton,\n\t\t\t\t\t\t\t"aria-label": t("actions.newSession.aria", { name: label }),', 'managed Workspace new Session')
  replace(
    '\t\tfunction SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t }) {\n\t\t\tconst row = node;',
    '\t\tfunction SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t }) {\n\t\t\tconst row = node;\n\t\t\tconst protectedManagedSession = node.__dshGitWorktree?.kind === "managed-worktree";',
    'managed Session row guard',
  )
  replace('\t\t\tconst draggable = drag !== void 0 && !row.blank;', '\t\t\tconst draggable = drag !== void 0 && !row.blank && !protectedManagedSession;', 'managed Session drag')
  replace('\t\t\t\t\t\t!row.blank && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,', '\t\t\t\t\t\t!row.blank && !protectedManagedSession && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,', 'managed Session actions')
  replace(
    '\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tref: titleRef,\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,',
    '\t\t\t\t\t\tprotectedManagedSession && (0, react_jsx_runtime.jsx)("span", { title: node.__dshGitWorktree.label, "aria-label": node.__dshGitWorktree.label, style: { flexShrink: 0, display: "inline-flex" }, children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}) }),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tref: titleRef,\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,',
    'managed Session branch decoration',
  )
  replace(
    '\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t}),\n\t\t\t\t\t\trow.hasActiveSchedule && (0, react_jsx_runtime.jsx)(ActiveScheduleIndicator, { t }),',
    '\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t}),\n\t\t\t\t\t\tprotectedManagedSession && (0, react_jsx_runtime.jsx)("span", { className: "dsh-git-worktree-sidebar-badge", "data-worktree-state": node.__dshGitWorktree.state, children: node.__dshGitWorktree.label }),\n\t\t\t\t\t\trow.hasActiveSchedule && (0, react_jsx_runtime.jsx)(ActiveScheduleIndicator, { t }),',
    'managed Session status badge',
  )
  return derived
}

export function materializeAlphaWorkspaceClientModule() {
  return materializeWorkspaceFactory(decorateAlphaWorkspaceClient(readAlphaWorkspaceClient()))
}
