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

  test.each([
    ['Desktop rc.5', 'Kjh-qa', 'JoiKIa', 'wp6hAG'],
    ['local rc.5 source build', 'ie6hUG', '_6euBGW', 'n96sPG'],
  ])('handles %s CSS names but not changed Browser logic', (_build, root, row, modal) => {
    const rebuilt = workspaceSource('-022-rc3').replaceAll('bhn1Oq_', `${root}_`)
      .replaceAll('YDXeBa_', `${row}_`).replaceAll('_G5b-a_', `${modal}_`)
    expect(workspaceClientFlavorForSource(rebuilt)).toBe('modern-022-rc3')
    const modified = rebuilt.replace('exports.apply=apply', 'exports.apply=() => {}')
    expect(modified).not.toBe(rebuilt)
    expect(workspaceClientFlavorForSource(modified)).toBe('unsupported')
    expect(workspaceClientFlavorForSource('')).toBe('unsupported')
  })
})
