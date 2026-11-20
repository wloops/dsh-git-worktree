import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { workspaceClientFlavorForSource } from '../src/host-compat.js'

const require = createRequire(import.meta.url)
const workspaceSource = (suffix: string) => readFileSync(require.resolve(`@deepseek-ai/dsh-client-ui-workspace${suffix}/client`), 'utf8')

describe('Workspace client selection', () => {
  test('uses a DSH peer floor without changing the reproducible build baseline', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const peers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(peers).toHaveLength(12)
    for (const [name, range] of peers) {
      expect(range).toBe('>=0.2.1-rc.2')
      expect(manifest.devDependencies[name]).toBe('0.2.1-rc.2')
    }
  })

  test.each([
    ['-alpha', 'alpha'], ['-next', 'next'], ['', 'modern'], ['-rc5', 'modern-rc5'],
    ['-022', 'modern-022'], ['-022-rc3', 'modern-022-rc3'],
  ])('selects the matching derivative from Workspace artifact %s', (suffix, flavor) => {
    expect(workspaceClientFlavorForSource(workspaceSource(suffix))).toBe(flavor)
  })

  test('handles the Desktop rc.5 CSS names but not changed Browser logic', () => {
    const desktop = workspaceSource('-022-rc3').replaceAll('bhn1Oq_', 'Kjh-qa_')
      .replaceAll('YDXeBa_', 'JoiKIa_').replaceAll('_G5b-a_', 'wp6hAG_')
    expect(workspaceClientFlavorForSource(desktop)).toBe('modern-022-rc3')
    const modified = desktop.replace('exports.apply=apply', 'exports.apply=() => {}')
    expect(modified).not.toBe(desktop)
    expect(workspaceClientFlavorForSource(modified)).toBe('unsupported')
    expect(workspaceClientFlavorForSource('')).toBe('unsupported')
  })
})
