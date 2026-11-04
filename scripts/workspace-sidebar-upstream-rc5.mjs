import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { decorateOfficialWorkspaceClient } from './workspace-sidebar-upstream.mjs'
import { materializeWorkspaceFactory } from './workspace-sidebar-upstream-next.mjs'
import { ownWorkspaceStyles } from './workspace-sidebar-resources.mjs'

export const RC5_WORKSPACE_VERSION = '0.2.1-rc.5'
export const RC5_WORKSPACE_SHA256 = '9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544'
export const RC5_WORKSPACE_VIRTUAL_ID = 'virtual:dsh-official-workspace-client-rc5'
export const RESOLVED_RC5_WORKSPACE_VIRTUAL_ID = `\0${RC5_WORKSPACE_VIRTUAL_ID}`

export function verifyRc5WorkspaceClient(packageJson, source) {
  if (packageJson.name !== '@deepseek-ai/dsh-client-ui-workspace' || packageJson.version !== RC5_WORKSPACE_VERSION) {
    throw new Error(`Unsupported official Workspace source ${packageJson.name}@${packageJson.version}`)
  }
  const digest = createHash('sha256').update(source).digest('hex')
  if (digest !== RC5_WORKSPACE_SHA256) throw new Error(`Official Workspace Client rc.5 hash drifted: ${digest}`)
  return source
}

export function readRc5WorkspaceClient() {
  const require = createRequire(import.meta.url)
  const packageName = '@deepseek-ai/dsh-client-ui-workspace-rc5'
  return verifyRc5WorkspaceClient(
    JSON.parse(readFileSync(require.resolve(`${packageName}/package.json`), 'utf8')),
    readFileSync(require.resolve(`${packageName}/client`), 'utf8'),
  )
}

// The managed-row seams are identical in these two pinned sources. Reuse only
// that fail-closed transform, never the rc.2 factory/source. In particular rc.5's
// connectBlank, preset-aware createInWorkspace and startSession remain rc.5.
export function decorateRc5WorkspaceClient(source) {
  return decorateOfficialWorkspaceClient(source)
}

export function materializeRc5WorkspaceClientModule() {
  return materializeWorkspaceFactory(ownWorkspaceStyles(
    decorateRc5WorkspaceClient(readRc5WorkspaceClient()), RC5_WORKSPACE_VERSION, 4,
  ))
}
