import { createRequire } from 'node:module'
import {
  readOfficialWorkspaceClient,
  WORKSPACE_LOCALE_VERSION,
  WORKSPACE_UI_VERSION,
} from './workspace-sidebar-upstream.mjs'
import { readNextWorkspaceClient, NEXT_WORKSPACE_VERSION } from './workspace-sidebar-upstream-next.mjs'
import { readAlphaWorkspaceClient, ALPHA_WORKSPACE_VERSION } from './workspace-sidebar-upstream-alpha.mjs'

const require = createRequire(import.meta.url)
const locale = require('@deepseek-ai/dsh-client-locale/package.json').version
if (locale !== WORKSPACE_LOCALE_VERSION) {
  throw new Error(`Workspace Sidebar compatibility gate failed: locale=${locale}, expected ${WORKSPACE_LOCALE_VERSION}`)
}
readOfficialWorkspaceClient()
readAlphaWorkspaceClient()
readNextWorkspaceClient()
console.log(`✓ Workspace Sidebar compatibility gate: ui-workspace ${WORKSPACE_UI_VERSION} + ${ALPHA_WORKSPACE_VERSION} + ${NEXT_WORKSPACE_VERSION} SHA-256, locale ${locale}`)
