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
      if (id === OFFICIAL_WORKSPACE_VIRTUAL_ID) return RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID
      if (id === NEXT_WORKSPACE_VIRTUAL_ID) return RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID
      if (id === ALPHA_WORKSPACE_VIRTUAL_ID) return RESOLVED_ALPHA_WORKSPACE_VIRTUAL_ID
      return null
    },
    load(id) {
      if (id === RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID) return materializeOfficialWorkspaceClientModule()
      if (id === RESOLVED_NEXT_WORKSPACE_VIRTUAL_ID) return materializeNextWorkspaceClientModule()
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
