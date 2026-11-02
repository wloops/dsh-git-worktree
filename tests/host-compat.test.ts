import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { workspaceClientFlavorForAgentVersion } from '../src/host-compat.js'

describe('Host-pinned Workspace generation', () => {
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

  test('only selects source-verified Browser generations and preserves the legacy path', () => {
    expect(workspaceClientFlavorForAgentVersion('0.1.2-rc.1')).toBe('legacy')
    expect(workspaceClientFlavorForAgentVersion('0.1.6-alpha.2')).toBe('alpha')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.2')).toBe('next')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.2')).toBe('modern')
    expect(workspaceClientFlavorForAgentVersion('0.2.0-rc.2')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.3')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.5')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion('0.2.1')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.3')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion(undefined)).toBe('unsupported')
  })
})
