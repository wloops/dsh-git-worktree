import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export type WorkspaceClientFlavor = 'legacy' | 'alpha' | 'next' | 'modern' | 'modern-rc5' | 'unsupported'

export function workspaceClientFlavorForAgentVersion(version: string | undefined): WorkspaceClientFlavor {
  if (version === '0.1.2-rc.1') return 'legacy'
  if (version === '0.1.6-alpha.2') return 'alpha'
  if (version === '0.1.7-rc.2') return 'next'
  // The modern derivative is built from this exact source, not the previous 0.2.0 line.
  if (version === '0.2.1-rc.2') return 'modern'
  if (version === '0.2.1-rc.5') return 'modern-rc5'
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
