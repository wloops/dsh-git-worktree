import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export type WorkspaceClientFlavor = 'legacy' | 'alpha' | 'next' | 'modern' | 'modern-rc5' | 'modern-022' | 'modern-022-rc3' | 'unsupported'

const WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'
const flavorsByFingerprint = new Map<string, WorkspaceClientFlavor>([
  ['53c40660195c42cde709b802e239f473dd721f45bc329684af31c01fdb73282a', 'legacy'],
  ['cec5cdfc90b0732356b678e84ee00949d26b8c1b70d4dd5fcc20660d7267e448', 'alpha'],
  ['854722447794b79607651e6c75d0652db1aba376324f468ab8cd6ecdfe7d177f', 'next'],
  ['52765aacb6c7f96327da5d8709d8cbb30dd2957d4744a42da04c18e07fe264e5', 'modern'],
  ['9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544', 'modern-rc5'],
  ['bb31f7870381f737b2cb45db4c7911a08a4949856bc86b648a10d3e85a3e9f89', 'modern-022'],
  ['3ff4116dc91b7dc5cc57e7672e0d7935f992b339be3444a7a72992df218765ba', 'modern-022-rc3'],
])

export function workspaceClientFlavorForSource(source: string): WorkspaceClientFlavor {
  const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex')
  const exact = flavorsByFingerprint.get(fingerprint(source))
  if (exact !== undefined) return exact
  // Desktop, npm and source builds generate different scoped CSS names.
  // Normalize only the three known CSS modules; all other bytes must match.
  // A generated prefix may include a leading underscore and vary in length.
  const prefixes = [...source.matchAll(/const css(?:\$\d+)?=`\.([\w-]+?)_(?:root|projectRow|modalAction)[{,]/g)]
  if (prefixes.length === 3 && new Set(prefixes.map(match => match[1])).size === 3) {
    const npmPrefixes = ['bhn1Oq', 'YDXeBa', '_G5b-a']
    const replacements = new Map(prefixes.map((match, index) => [`${match[1]}_`, `${npmPrefixes[index]}_`]))
    const pattern = [...replacements.keys()].join('|')
    source = source.replace(new RegExp(pattern, 'g'), match => replacements.get(match) ?? match)
  }
  return flavorsByFingerprint.get(fingerprint(source)) ?? 'unsupported'
}

/** Resolve from the running Host's Web bundle, not the plugin's dev dependencies. */
export function resolveWorkspaceClientFlavor(ctx: Context): WorkspaceClientFlavor {
  const profile = (ctx as Context & { profileContext?: { installAnchor?: string } }).profileContext
  const installAnchor = profile?.installAnchor
  const entry = [...ctx.loader.entries()].find(row => row.options.name === WORKSPACE)
  const baseUrl = entry?.parent.tree.ctx.baseUrl
  if (baseUrl) {
    const internal = ctx.loader.internal
    if (internal && typeof internal.resolveSync === 'function') {
      try {
        const result = internal.version === 'v2'
          ? internal.resolveSync(baseUrl, { specifier: WORKSPACE, attributes: {} })
          : internal.resolveSync(WORKSPACE, baseUrl, {})
        return workspaceClientFlavorForModule(fileURLToPath(result.url))
      } catch { return 'unsupported' }
    }
  }
  return hostWorkspaceClientFlavor(installAnchor, baseUrl)
}

/** Web uses the owning Host package's default client export, not Node's active export conditions. */
function workspaceClientFlavorForModule(modulePath: string): WorkspaceClientFlavor {
  for (let dir = dirname(modulePath); ; dir = dirname(dir)) {
    let manifest: { name?: unknown; exports?: { './client'?: unknown } } | undefined
    try { manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }
    catch { /* A module can be nested below its owning package. */ }
    if (manifest?.name === WORKSPACE) {
      const client = manifest.exports?.['./client']
      const path = typeof client === 'object' && client !== null ? Reflect.get(client, 'default') : client
      if (typeof path !== 'string' || !path.startsWith('./')) return 'unsupported'
      return workspaceClientFlavorForSource(readFileSync(join(dir, path), 'utf8'))
    }
    if (dirname(dir) === dir) return 'unsupported'
  }
}

export function hostWorkspaceClientFlavor(installAnchor?: string, workspaceBaseUrl?: string): WorkspaceClientFlavor {
  try {
    if (workspaceBaseUrl !== undefined) {
      return workspaceClientFlavorForModule(createRequire(workspaceBaseUrl).resolve(WORKSPACE))
    }
    if (installAnchor === undefined) return 'unsupported'
    const host = createRequire(installAnchor)
    let modulePath: string
    try {
      const web = createRequire(host.resolve('@deepseek-ai/dsh-web-app/package.json'))
      modulePath = web.resolve(WORKSPACE)
    } catch {
      modulePath = host.resolve(WORKSPACE)
    }
    return workspaceClientFlavorForModule(modulePath)
  } catch { return 'unsupported' }
}
