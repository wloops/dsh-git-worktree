import { defineConfig } from 'tsdown'
import {
  materializeOfficialWorkspaceClientModule,
  OFFICIAL_WORKSPACE_VIRTUAL_ID,
  RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID,
} from './scripts/workspace-sidebar-upstream.mjs'

const CLIENT_PLUGIN_ID = 'dsh-git-worktree'

export default defineConfig({
  name: 'dsh-git-worktree-client',
  entry: { client: 'src/client/console-remote/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'neutral',
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
  noExternal: ['zod'],
  plugins: [{
    name: 'official-workspace-client-source',
    resolveId(id) {
      return id === OFFICIAL_WORKSPACE_VIRTUAL_ID
        ? RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID
        : null
    },
    load(id) {
      return id === RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID
        ? materializeOfficialWorkspaceClientModule()
        : null
    },
  }],
  outputOptions: {
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_PLUGIN_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
