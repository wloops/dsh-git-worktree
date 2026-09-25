import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export type WorkspaceClientFlavor = 'legacy' | 'alpha' | 'next' | 'unsupported'

export function workspaceClientFlavorForAgentVersion(version: string | undefined): WorkspaceClientFlavor {
  if (version === '0.1.2-rc.1') return 'legacy'
  if (version === '0.1.6-alpha.2') return 'alpha'
  if (version === '0.1.7-rc.2') return 'next'
  return 'unsupported'
}

/** The Host-resolved agent package is a version signal, not the plugin's build-time dev dependency. */
export function hostWorkspaceClientFlavor(): WorkspaceClientFlavor {
  try {
    const require = createRequire(import.meta.url)
    const agent = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-agent/package.json'), 'utf8')) as {
      name?: string; version?: string
    }
    if (agent.name === '@deepseek-ai/dsh-agent') return workspaceClientFlavorForAgentVersion(agent.version)
  } catch { /* Unknown Host: keep the official provider, never install a guessed derivative. */ }
  return 'unsupported'
}
