import { createRequire } from 'node:module'
import {
  readOfficialWorkspaceClient,
  WORKSPACE_LOCALE_VERSION,
  WORKSPACE_UI_VERSION,
} from './workspace-sidebar-upstream.mjs'

const require = createRequire(import.meta.url)
const locale = require('@deepseek-ai/dsh-client-locale/package.json').version
if (locale !== WORKSPACE_LOCALE_VERSION) {
  throw new Error(`Workspace Sidebar compatibility gate failed: locale=${locale}, expected ${WORKSPACE_LOCALE_VERSION}`)
}
readOfficialWorkspaceClient()
console.log(`✓ Workspace Sidebar compatibility gate: ui-workspace ${WORKSPACE_UI_VERSION} + SHA-256, locale ${locale}`)
