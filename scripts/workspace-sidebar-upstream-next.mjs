import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export const NEXT_WORKSPACE_VERSION = '0.1.7-rc.2'
export const NEXT_WORKSPACE_SHA256 = '854722447794b79607651e6c75d0652db1aba376324f468ab8cd6ecdfe7d177f'
export const NEXT_WORKSPACE_VIRTUAL_ID = 'virtual:dsh-official-workspace-client-next'
export const RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID = `\0${NEXT_WORKSPACE_VIRTUAL_ID}`

export function readNextWorkspaceClient() {
  const require = createRequire(import.meta.url)
  const packageName = '@deepseek-ai/dsh-client-ui-workspace-next'
  const packageJson = JSON.parse(readFileSync(require.resolve(`${packageName}/package.json`), 'utf8'))
  if (packageJson.name !== '@deepseek-ai/dsh-client-ui-workspace' || packageJson.version !== NEXT_WORKSPACE_VERSION) {
    throw new Error(`Unsupported official Workspace source ${packageJson.name}@${packageJson.version}`)
  }
  const source = readFileSync(require.resolve(`${packageName}/client`), 'utf8')
  const hash = createHash('sha256').update(source).digest('hex')
  if (hash !== NEXT_WORKSPACE_SHA256) throw new Error(`Official Workspace Client hash drifted: ${hash}`)
  return source
}

function once(source, needle, replacement, label) {
  const start = source.indexOf(needle)
  if (start < 0 || start !== source.lastIndexOf(needle)) {
    throw new Error(`Cannot derive official Workspace ${NEXT_WORKSPACE_VERSION} ${label}: expected one source seam`)
  }
  return source.slice(0, start) + replacement + source.slice(start + needle.length)
}

/** Keep the official Client's tree and behavior, changing only managed-owner presentation/controls. */
export function decorateNextWorkspaceClient(source) {
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
  // Cordis Service derives its own Context; capture the instance-local guard
  // from the constructor argument rather than looking it up on this.ctx later.
  replace(
    '\t\t\t\tsuper(ctx, "uiWorkspace");\n\t\t\t\tthis.directoryPicker = directoryPicker;',
    '\t\t\t\tsuper(ctx, "uiWorkspace");\n\t\t\t\tthis.managedWorktreeGuard = ctx.get("__dshGitWorktreeManagedGuard");\n\t\t\t\tthis.directoryPicker = directoryPicker;',
    'instance-local managed guard',
  )
  replace(
    '\t\t\tasync forkSession(sessionId) {\n\t\t\t\tawait this.sessions.fork({',
    '\t\t\tasync forkSession(sessionId) {\n\t\t\t\tif (this.managedWorktreeGuard.blockSession(sessionId)) throw new Error("managed Session must be changed through its Worktree owner");\n\t\t\t\tawait this.sessions.fork({',
    'managed Session fork from official menu and shortcuts',
  )
  replace(
    '\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? recent;\n\t\t\t\tif (target === void 0) {',
    '\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? recent;\n\t\t\t\tif (target !== void 0 && this.managedWorktreeGuard.blockWorkspace(target)) return;\n\t\t\t\tif (target === void 0) {',
    'managed Workspace new Session shortcut',
  )
  replace(
    '\t\t\t\tupdatedAt: s.updatedAt,\n\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction }',
    '\t\t\t\tupdatedAt: s.updatedAt,\n\t\t\t\t__dshGitWorktree: s.__dshGitWorktree,\n\t\t\t\t...pendingInteraction === void 0 ? {} : { pendingInteraction }',
    'managed Session metadata',
  )
  replace(
    '\t\tfunction ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, newShortcut, t }) {\n\t\t\tconst row = group;',
    '\t\tfunction ProjectRowItem({ group, containsCurrentDescendant = false, onToggle, onCreate, actions, drag, home, newShortcut, t }) {\n\t\t\tconst row = group;\n\t\t\tconst protectedManagedWorkspace = row.__dshGitWorktreeProtected === true;',
    'managed Workspace row guard',
  )
  replace('\t\t\t\tdraggable: drag !== void 0,', '\t\t\t\tdraggable: drag !== void 0 && !protectedManagedWorkspace,', 'managed Workspace drag')
  replace('\t\t\t\tonDragStart: drag === void 0 ? void 0 : (e) => {', '\t\t\t\tonDragStart: protectedManagedWorkspace || drag === void 0 ? void 0 : (e) => {', 'managed Workspace drag start')
  replace('\t\t\t\t\t\tchildren: [actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {', '\t\t\t\t\t\tchildren: [!protectedManagedWorkspace && actions !== void 0 && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {', 'managed Workspace menu')
  replace('\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {\n\t\t\t\t\t\t\tlabel: t("actions.newSession"),', '\t\t\t\t\t\t}), !protectedManagedWorkspace && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {\n\t\t\t\t\t\t\tlabel: t("actions.newSession"),', 'managed Workspace new Session')
  replace(
    '\t\tfunction SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t }) {\n\t\t\tconst row = node;',
    '\t\tfunction SessionNodeItem({ node, currentId, now, onOpen, onRenameRequest, renderSlot, onReveal, drag, t }) {\n\t\t\tconst row = node;\n\t\t\tconst protectedManagedSession = node.__dshGitWorktree?.kind === "managed-worktree";',
    'managed Session row guard',
  )
  replace('\t\t\tconst draggable = drag !== void 0 && !row.blank && !row.archived;', '\t\t\tconst draggable = drag !== void 0 && !row.blank && !row.archived && !protectedManagedSession;', 'managed Session drag')
  // Keep the official hover container. The Slot proxy preserves pin, rename
  // and archive on managed owners while filtering ownership-changing actions.
  replace(
    '\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tref: titleRef,\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,',
    '\t\t\t\t\t\tprotectedManagedSession && (0, react_jsx_runtime.jsx)("span", { title: node.__dshGitWorktree.label, "aria-label": node.__dshGitWorktree.label, style: { flexShrink: 0, display: "inline-flex" }, children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size: 16 }) }),\n\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tref: titleRef,\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,',
    'managed Session branch decoration',
  )
  replace(
    '\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t!row.blank && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.time,',
    '\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t}),\n\t\t\t\t\t\tprotectedManagedSession && node.__dshGitWorktree.state !== "working" && (0, react_jsx_runtime.jsx)("span", { className: "dsh-git-worktree-sidebar-badge", "data-worktree-state": node.__dshGitWorktree.state, children: node.__dshGitWorktree.label }),\n\t\t\t\t\t\t!row.blank && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.time,',
    'managed Session status badge',
  )
  return derived
}

export function materializeNextWorkspaceClientModule() {
  return materializeWorkspaceFactory(decorateNextWorkspaceClient(readNextWorkspaceClient()))
}

/** Load one pinned official Client factory without registering its upstream ModuleLoader row. */
export function materializeWorkspaceFactory(source) {
  const token = 'factory: (require) => {'
  const start = source.indexOf(token)
  const end = source.lastIndexOf('\n\t}\n});')
  if (start < 0 || end < 0 || end <= start) throw new Error('Cannot extract official Workspace Client factory')
  const body = source.slice(start + token.length, end)
  return `
import * as cordis from '@deepseek-ai/cordis'
import * as store from '@deepseek-ai/dsh-client-store'
import * as jsxRuntime from 'react/jsx-runtime'
import * as react from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
const modules = {
  '@deepseek-ai/cordis': cordis,
  '@deepseek-ai/dsh-client-store': store,
  'react/jsx-runtime': jsxRuntime,
  'react': react,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}
const official = ((require) => {${body}
})(specifier => {
  const value = modules[specifier]
  if (value === undefined) throw new Error('Unsupported official Workspace Client require: ' + specifier)
  return value
})
export const apply = official.apply
export const inject = official.inject
`
}
