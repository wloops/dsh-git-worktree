import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { materializeWorkspaceFactory } from './workspace-sidebar-upstream-next.mjs'
import { ownWorkspaceStyles } from './workspace-sidebar-resources.mjs'

export const V022_RC3_WORKSPACE_VERSION = '0.2.2-rc.3'
// The npm and Desktop clients differ only in their three CSS class prefixes.
// Build against the npm alias; the Desktop ASAR client hashes to
// fff4925f33f7db85fa0a28d51d59f5a970af02a9058d2fe11deee75a5d549af6.
export const V022_RC3_WORKSPACE_SHA256 = '3ff4116dc91b7dc5cc57e7672e0d7935f992b339be3444a7a72992df218765ba'
export const V022_RC3_WORKSPACE_VIRTUAL_ID = 'virtual:dsh-official-workspace-client-022-rc3'
export const RESOLVED_V022_RC3_WORKSPACE_VIRTUAL_ID = `\0${V022_RC3_WORKSPACE_VIRTUAL_ID}`

export function verifyV022Rc3WorkspaceClient(manifest, source) {
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-workspace' || manifest.version !== V022_RC3_WORKSPACE_VERSION) {
    throw new Error(`Unsupported official Workspace source ${manifest.name}@${manifest.version}`)
  }
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== V022_RC3_WORKSPACE_SHA256) throw new Error(`Official Workspace Client ${V022_RC3_WORKSPACE_VERSION} hash drifted: ${digest}`)
  return source
}

export function readV022Rc3WorkspaceClient() {
  const require = createRequire(import.meta.url)
  const name = '@deepseek-ai/dsh-client-ui-workspace-022-rc3'
  return verifyV022Rc3WorkspaceClient(JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')),
    readFileSync(require.resolve(`${name}/client`), 'utf8'))
}

function once(source, needle, replacement, label) {
  const at = source.indexOf(needle)
  if (at < 0 || at !== source.lastIndexOf(needle)) {
    throw new Error(`Cannot derive Workspace ${V022_RC3_WORKSPACE_VERSION} ${label}: expected one stable source seam`)
  }
  return source.slice(0, at) + replacement + source.slice(at + needle.length)
}

// Pin literal minified seams rather than reformatting the upstream factory.
// Its native context menus, search, navigation, access, and Slots stay intact.
export function decorateV022Rc3WorkspaceClient(source) {
  let derived = source
  const replace = (needle, replacement, label) => { derived = once(derived, needle, replacement, label) }
  replace('super(ctx,`uiWorkspace`);', 'super(ctx,`uiWorkspace`);this.managedWorktreeGuard=ctx.get("__dshGitWorktreeManagedGuard");', 'instance guard')
  replace('async forkSession(sessionId,onCreated,options){', 'async forkSession(sessionId,onCreated,options){if(this.managedWorktreeGuard.blockSession(sessionId))throw new Error("managed Session must be changed through its Worktree owner");', 'managed Session fork')
  replace('const target=workspaceId??currentWorkspaceId??recent;', 'const rawTarget=workspaceId??currentWorkspaceId??recent;if(workspaceId!==void 0&&this.managedWorktreeGuard.blockWorkspace(workspaceId))return;const target=workspaceId===void 0?this.managedWorktreeGuard.resolveStartTarget(rawTarget):rawTarget;', 'managed Workspace new Session')
  // The official Browser reorders Workspaces remotely. Protect the persisted
  // source and anchor even when a drag becomes stale before it is committed.
  replace('insertWorkspaceBefore:async(workspaceId,beforeWorkspaceId)=>{await workspaces.insertBefore(workspaceId,beforeWorkspaceId)}',
    'insertWorkspaceBefore:async(workspaceId,beforeWorkspaceId)=>{const guard=ctx.get("__dshGitWorktreeManagedGuard");if(guard.blockWorkspace(workspaceId)||(beforeWorkspaceId!==void 0&&guard.blockWorkspace(beforeWorkspaceId)))return;await workspaces.insertBefore(workspaceId,beforeWorkspaceId)}', 'Workspace reorder guard')
  replace('const commitWorkspaceDrag=(activeDrag,over)=>{',
    'const protectedWorkspaces=new Set(workspaces.filter(workspace=>workspace.__dshGitWorktreeProtected===true).map(workspace=>workspace.workspaceId));const commitWorkspaceDrag=(activeDrag,over)=>{', 'protected Workspace drag IDs')
  replace('setWorkspaceDrag(null);const owner=parents.get(activeDrag.workspaceId);',
    'setWorkspaceDrag(null);if(protectedWorkspaces.has(activeDrag.workspaceId)||protectedWorkspaces.has(over.id))return;const owner=parents.get(activeDrag.workspaceId);', 'managed Workspace drop')
  replace('const workspaceDragProps=workspaceId===void 0?void 0:', 'const workspaceDragProps=workspaceId===void 0||protectedWorkspaces.has(workspaceId)?void 0:', 'managed Workspace drag origin')
  replace('const compatibleDrag=workspaceDrag!==null&&parents.get(workspaceDrag.workspaceId)===parents.get(group.key);',
    'const compatibleDrag=workspaceDrag!==null&&parents.get(workspaceDrag.workspaceId)===parents.get(group.key)&&!protectedWorkspaces.has(workspaceId);', 'managed Workspace drag target')
  replace('updatedAt:s.updatedAt,', 'updatedAt:s.updatedAt,__dshGitWorktree:s.__dshGitWorktree,', 'Session metadata')
  replace('workspace:labelOf(summary),', 'workspace:labelOf(summary),__dshGitWorktree:summary.__dshGitWorktree,', 'search metadata')
  replace('const draggable=drag!==void 0&&reorderable&&!row.blank&&!row.archived;', 'const draggable=drag!==void 0&&reorderable&&!row.blank&&!row.archived&&node.__dshGitWorktree===void 0;', 'managed Session drag')
  replace('if(source===void 0||target===void 0||source.blank||source.pinned!==drag.pinned',
    'if(source===void 0||target===void 0||source.__dshGitWorktree!==void 0||target.__dshGitWorktree!==void 0||source.blank||source.pinned!==drag.pinned', 'managed Session drop')
  replace('function SessionHoverContent({node,cwd,now,renderSlot,t}){', `function ManagedWorktreeIdentity({ node, hover = false }) {
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
  function SessionHoverContent({node,cwd,now,renderSlot,t}){`, 'Worktree identity component')
  replace('renderSlot(`sidebar.session.row.hover`,{sessionId:node.id}),', '(0,react_jsx_runtime.jsx)(ManagedWorktreeIdentity,{node,hover:true}),renderSlot(`sidebar.session.row.hover`,{sessionId:node.id}),', 'Session hover identity')
  replace('"data-row-key":`session:${node.id}`,', '"data-row-key":`session:${node.id}`,"data-managed-worktree":node.__dshGitWorktree===void 0?void 0:"true",', 'Session row marker')
  replace('(0,react_jsx_runtime.jsx)(`span`,{ref:titleRef,', '(0,react_jsx_runtime.jsx)(ManagedWorktreeIdentity,{node}),(0,react_jsx_runtime.jsx)(`span`,{ref:titleRef,', 'Session row identity')
  replace('className:clsx(Rows_module_css_default.searchResultRow,selected&&Rows_module_css_default.selected,result.archived&&Rows_module_css_default.archived),', 'className:clsx(Rows_module_css_default.searchResultRow,selected&&Rows_module_css_default.selected,result.archived&&Rows_module_css_default.archived),"data-managed-worktree":result.__dshGitWorktree===void 0?void 0:"true",', 'search result marker')
  replace('(0,react_jsx_runtime.jsx)(`span`,{className:Rows_module_css_default.searchResultTitle,', '(0,react_jsx_runtime.jsx)(ManagedWorktreeIdentity,{node:result}),(0,react_jsx_runtime.jsx)(`span`,{className:Rows_module_css_default.searchResultTitle,', 'search result identity')
  return derived
}

export function materializeV022Rc3WorkspaceClientModule() {
  // Adapt only the minified wrapper and CSS registration syntax to the shared
  // materializer. Keep the three CSS strings and class maps byte-for-byte.
  let source = decorateV022Rc3WorkspaceClient(readV022Rc3WorkspaceClient())
  source = once(source, 'factory:require=>{', 'factory: (require) => {', 'factory opening')
  source = once(source, 'return module.exports}});', 'return module.exports\n\t}\n});', 'factory closing')
  source = source.replace(/const (tagId(?:\$\d+)?)=`(@deepseek-ai\/dsh-client-ui-workspace\/[^`]+\.module\.css)`;/gu,
    (_match, name, id) => `const ${name} = ${JSON.stringify(id)};`)
  source = source.replaceAll('tag.dataset.plugin=`@deepseek-ai/dsh-client-ui-workspace`;', 'tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace";')
  return materializeWorkspaceFactory(ownWorkspaceStyles(source, V022_RC3_WORKSPACE_VERSION, 3))
}
