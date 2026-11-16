import { materializeV022WorkspaceClientModule } from '../scripts/workspace-sidebar-upstream-022.mjs'
// @vitest-environment jsdom
import { materializeV022Rc3WorkspaceClientModule } from '../scripts/workspace-sidebar-upstream-022-rc3.mjs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, test } from 'vitest'
import { ownWorkspaceStyles } from '../scripts/workspace-sidebar-resources.mjs'
import { materializeOfficialWorkspaceClientModule } from '../scripts/workspace-sidebar-upstream.mjs'
import { materializeNextWorkspaceClientModule } from '../scripts/workspace-sidebar-upstream-next.mjs'
import { materializeAlphaWorkspaceClientModule } from '../scripts/workspace-sidebar-upstream-alpha.mjs'

import { materializeRc5WorkspaceClientModule } from '../scripts/workspace-sidebar-upstream-rc5.mjs'

const require = createRequire(import.meta.url)
const owner = '@deepseek-ai/dsh-client-ui-workspace'
const variants = [
  [`${owner}-022`, '0.2.2-rc.1', 3, materializeV022WorkspaceClientModule],
  [`${owner}-022-rc3`, '0.2.2-rc.3', 3, materializeV022Rc3WorkspaceClientModule],
  [`${owner}-rc5`, '0.2.1-rc.5', 4, materializeRc5WorkspaceClientModule],
  [owner, '0.2.1-rc.2', 4, materializeOfficialWorkspaceClientModule],
  [`${owner}-next`, '0.1.7-rc.2', 4, materializeNextWorkspaceClientModule],
  [`${owner}-alpha`, '0.1.6-alpha.2', 3, materializeAlphaWorkspaceClientModule],
] as const
function materialize(source: string, ownerDocument: unknown = document) {
  let factory!: (require: (id: string) => unknown) => unknown
  new Function('window', 'document', source)({ __ModuleLoader__: { load(value: { factory: typeof factory }) { factory = value.factory } } }, ownerDocument)
  return factory(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id))
}
function removeOwnedStyles(id: string) {
  // Same ownership contract as dsh-client-modules' removeOwnedStyles().
  for (const tag of document.querySelectorAll('style[data-plugin]')) {
    if (tag.getAttribute('data-plugin') === id) tag.remove()
  }
}
function styles() { return [...document.querySelectorAll<HTMLStyleElement>('style[data-plugin-css]')] }
afterEach(() => document.head.replaceChildren())

describe('embedded official Workspace CSS ownership', () => {
  const derivedStyleCount = variants.reduce((total, [, , count]) => total + count, 0)
  test.each(variants.flatMap(([pkg, , count]) => [[false, pkg, count], [true, pkg, count]] as const))('built factory keeps every generation intact (official first: %s, package: %s)', (officialFirst, officialPackage, officialCount) => {
    const official = readFileSync(require.resolve(`${officialPackage}/client`), 'utf8')
    if (officialFirst) materialize(official)
    // Execute the real built artifact: all virtual modules run eagerly.
    materialize(readFileSync('lib/client.js', 'utf8'))
    if (!officialFirst) materialize(official)
    for (const [pkg, version, count] of variants) {
      const upstream = readFileSync(require.resolve(`${pkg}/client`), 'utf8')
      // Execute upstream registration instead of depending on its JS string
      // syntax (recent builds use minified template literals for CSS).
      const upstreamHead = document.head.cloneNode(false) as HTMLHeadElement
      const register = (tag: HTMLStyleElement) => upstreamHead.appendChild(tag)
      materialize(upstream, {
        head: { appendChild: register },
        createElement: (name: string) => document.createElement(name),
        querySelector: (selector: string) => upstreamHead.querySelector(selector),
      })
      const cssBytes = [...upstreamHead.querySelectorAll('style[data-plugin-css]')].map(tag => tag.textContent)
      expect(cssBytes).toHaveLength(count)
      const tags = styles().filter(tag => tag.dataset.pluginCss?.startsWith(`dsh-git-worktree/workspace-${version}/`))
      expect(tags).toHaveLength(count)
      expect(tags.map(tag => tag.textContent)).toEqual(cssBytes)
      expect(tags.every(tag => tag.dataset.plugin === 'dsh-git-worktree')).toBe(true)
    }
    expect(styles()).toHaveLength(derivedStyleCount + officialCount)
    removeOwnedStyles(owner)
    expect(styles()).toHaveLength(derivedStyleCount)
    // Host rematerialization cannot remove or suppress derivative rules.
    materialize(official)
    expect(styles()).toHaveLength(derivedStyleCount + officialCount)
    removeOwnedStyles('dsh-git-worktree')
    expect(styles()).toHaveLength(officialCount)
    expect(styles().every(tag => tag.dataset.plugin === owner)).toBe(true)
    materialize(readFileSync('lib/client.js', 'utf8'))
    expect(styles()).toHaveLength(derivedStyleCount + officialCount)
  })
  test('all derived source factories have independent resource keys', () => {
    for (const [, version, count, derive] of variants) {
      const source = derive()
      expect(source.match(/tag.dataset.plugin = "dsh-git-worktree"/gu)).toHaveLength(count)
      expect(source).toContain(`dsh-git-worktree/workspace-${version}/WorkspaceBrowser.module.css`)
    }
  })
  test('fails closed if resource seams disappear or multiply', () => {
    expect(() => ownWorkspaceStyles('', 'test', 4)).toThrow(/expected 4 keys\/owners/)
    const seam = 'const tagId = "@deepseek-ai/dsh-client-ui-workspace/Rows.module.css"; tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-workspace";'
    expect(() => ownWorkspaceStyles(seam + seam, 'test', 1)).toThrow(/got 2\/2/)
  })
})
