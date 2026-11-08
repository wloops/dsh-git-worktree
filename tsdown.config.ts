import { materializeV022WorkspaceClientModule, V022_WORKSPACE_VIRTUAL_ID, RESOLVED_V022_WORKSPACE_VIRTUAL_ID } from './scripts/workspace-sidebar-upstream-022.mjs'
import { defineConfig } from 'tsdown'
import {
  materializeOfficialWorkspaceClientModule,
  OFFICIAL_WORKSPACE_VIRTUAL_ID,
  RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID,
} from './scripts/workspace-sidebar-upstream.mjs'
import {
  materializeNextWorkspaceClientModule,
  NEXT_WORKSPACE_VIRTUAL_ID,
  RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID,
} from './scripts/workspace-sidebar-upstream-next.mjs'
import {
  materializeAlphaWorkspaceClientModule,
  ALPHA_WORKSPACE_VIRTUAL_ID,
  RESOLVED_ALPHA_WORKSPACE_VIRTUAL_ID,
} from './scripts/workspace-sidebar-upstream-alpha.mjs'

import {
  materializeRc5WorkspaceClientModule,
  RC5_WORKSPACE_VIRTUAL_ID,
  RESOLVED_RC5_WORKSPACE_VIRTUAL_ID,
} from './scripts/workspace-sidebar-upstream-rc5.mjs'

const CLIENT_PLUGIN_ID = 'dsh-git-worktree'

export default defineConfig({
  name: 'dsh-git-worktree-client',
  entry: { client: 'src/client/console-remote/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'neutral',
  inputOptions: { resolve: { mainFields: ['module', 'main'] } },
  target: 'es2022',
  clean: false,
  sourcemap: false,
  dts: false,
  outExtensions: () => ({ js: '.js' }),
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  noExternal: ['zod', 'lucide-react'],
  plugins: [{
    name: 'official-workspace-client-source',
    resolveId(id) {
      if (id === V022_WORKSPACE_VIRTUAL_ID) return RESOLVED_V022_WORKSPACE_VIRTUAL_ID
      if (id === OFFICIAL_WORKSPACE_VIRTUAL_ID) return RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID
      if (id === NEXT_WORKSPACE_VIRTUAL_ID) return RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID
      if (id === RC5_WORKSPACE_VIRTUAL_ID) return RESOLVED_RC5_WORKSPACE_VIRTUAL_ID
      if (id === ALPHA_WORKSPACE_VIRTUAL_ID) return RESOLVED_ALPHA_WORKSPACE_VIRTUAL_ID
      return null
    },
    load(id) {
      if (id === RESOLVED_V022_WORKSPACE_VIRTUAL_ID) return materializeV022WorkspaceClientModule()
      if (id === RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID) return materializeOfficialWorkspaceClientModule()
      if (id === RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID) return materializeNextWorkspaceClientModule()
      if (id === RESOLVED_RC5_WORKSPACE_VIRTUAL_ID) return materializeRc5WorkspaceClientModule()
      if (id === RESOLVED_ALPHA_WORKSPACE_VIRTUAL_ID) return materializeAlphaWorkspaceClientModule()
      return null
    },
  }],
  outputOptions: {
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_PLUGIN_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
