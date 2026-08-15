import { defineConfig } from 'tsdown'

const banner = `(async ({ __require__, __exports__ }) => {
const module = { exports: __exports__ };
const exports = module.exports;
const require = __require__;`
const footer = `
globalThis.__dsh_current_exports__ = module.exports;
})`

export default defineConfig({
  name: 'dsh-git-worktree-client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'neutral',
  target: 'es2022',
  clean: false,
  sourcemap: false,
  dts: false,
  outExtensions: () => ({ js: '.js' }),
  external: ['react', 'react/jsx-runtime'],
  banner,
  footer,
})
