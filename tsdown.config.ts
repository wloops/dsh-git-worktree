import { defineConfig } from 'tsdown'

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
  external: ['react', 'react/jsx-runtime'],
  // Strict Remote schemas execute in the browser bundle; zod is not a Harness
  // ModuleLoader platform entry and therefore must never survive as require('zod').
  noExternal: ['zod'],
  outputOptions: {
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_PLUGIN_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
