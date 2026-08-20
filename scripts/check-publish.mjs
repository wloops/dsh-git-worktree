/**
 * Pre-publish integrity gate. It validates every declared export, the Host
 * mount patch, and the browser closure bundle instead of checking only the
 * root entry. Set CHECK_PUBLISH_REQUIRE_CLEAN=1 in release CI to additionally
 * require a clean Git checkout.
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const fail = (message) => { console.error(`check-publish: FAIL: ${message}`); process.exit(1) }
const ok = (message) => console.log(`check-publish: ok: ${message}`)
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

function exportTargets(value, label) {
  if (typeof value === 'string') return [{ condition: 'default', target: value }]
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a path or condition map`)
  return Object.entries(value).flatMap(([condition, nested]) => {
    if (typeof nested === 'string') return [{ condition, target: nested }]
    return exportTargets(nested, `${label}.${condition}`)
  })
}

function includedByFiles(target) {
  const normalized = target.replace(/^\.\//, '').replaceAll('\\', '/')
  if (normalized === 'package.json') return true
  return (manifest.files ?? []).some((entry) => {
    const normalizedEntry = String(entry).replace(/^\.\//, '').replaceAll('\\', '/').replace(/\/$/, '')
    return normalized === normalizedEntry || normalized.startsWith(`${normalizedEntry}/`)
  })
}

// 1. Host bundle declaration and patch.
const patchRel = manifest.dsh?.bundle?.patch
if (typeof patchRel !== 'string' || patchRel.length === 0) {
  fail('package.json lacks "dsh".bundle.patch — dsh plugin add would install a plain dependency without mounting it')
}
const patchPath = resolve(root, patchRel)
if (!existsSync(patchPath)) fail(`declared patch file ${patchRel} does not exist`)
if (!includedByFiles(patchRel)) fail(`${patchRel} is not covered by package.json "files"`)
const patch = readFileSync(patchPath, 'utf8')
if (!patch.includes('- insert:') || !patch.includes(`name: ${manifest.name}`)) {
  fail(`${patchRel} must insert one plugin row named ${manifest.name}`)
}
ok(`Host mount patch ${patchRel}`)

// 2. Every package export must exist and be included in the tarball.
const exportsMap = manifest.exports
if (!exportsMap || typeof exportsMap !== 'object' || Array.isArray(exportsMap)) fail('package.json lacks an exports map')
let exportCount = 0
for (const [subpath, value] of Object.entries(exportsMap)) {
  for (const { condition, target } of exportTargets(value, `exports[${JSON.stringify(subpath)}]`)) {
    exportCount += 1
    if (!target.startsWith('./')) fail(`export ${subpath} (${condition}) must be package-relative: ${target}`)
    const absolute = resolve(root, target)
    const inside = relative(root, absolute)
    if (inside.startsWith(`..${sep}`) || inside === '..') fail(`export ${subpath} escapes the package: ${target}`)
    if (!existsSync(absolute)) fail(`export ${subpath} (${condition}) points to missing ${target} — run build first`)
    if (!includedByFiles(target)) fail(`export ${subpath} (${condition}) target ${target} is not covered by package.json "files"`)
  }
}
ok(`${exportCount} export targets exist and are publishable`)

for (const stale of [
  'lib/client/review-console/DiffViewer.js',
  'lib/client/review-console/useReviewDiff.js',
]) {
  if (existsSync(resolve(root, stale))) fail(`removed acceptance UI survived as stale build output: ${stale}`)
}
ok('removed Diff UI has no stale publish artifact')

// 3. Manual strict Typert artifacts: one descriptor identity feeds Host Loader and Client mount.
if (manifest.dependencies?.['@deepseek-ai/dsh-typert-generator'] || manifest.devDependencies?.['@deepseek-ai/dsh-typert-generator']) {
  fail('manual contribution package must not depend on @deepseek-ai/dsh-typert-generator')
}
const typertExport = exportsMap['./typert']?.default
const remoteExport = exportsMap['./remote']?.default
if (typeof typertExport !== 'string' || typeof remoteExport !== 'string') {
  fail('package must export both ./typert and ./remote artifacts')
}
let hostContribution
let remoteContribution
try {
  hostContribution = (await import(pathToFileURL(resolve(root, typertExport)).href)).TYPERT
  remoteContribution = (await import(pathToFileURL(resolve(root, remoteExport)).href)).default
} catch (error) {
  fail(`Typert artifacts failed to import: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}
if (hostContribution?.package !== manifest.name || hostContribution.face !== 'host') fail('./typert has invalid package/face identity')
if (remoteContribution?.package !== manifest.name) fail('./remote has invalid package identity')
if (hostContribution.invocations !== remoteContribution.descriptors) fail('./typert and ./remote must share one descriptor array instance')
const expectedRemoteMethods = ['current', 'list', 'create', 'inspect', 'reviewDiff', 'preflight', 'preview', 'resumeRevision', 'rollbackPreview', 'discard', 'finalize', 'finalizePreview', 'setRetention', 'retryCleanup', 'beginNextIteration']
if (JSON.stringify(hostContribution.invocations.map(value => value.method)) !== JSON.stringify(expectedRemoteMethods)) {
  fail(`manual Remote methods differ from the required surface: ${hostContribution.invocations.map(value => value.method).join(', ')}`)
}
for (const descriptor of hostContribution.invocations) {
  if (descriptor.namespace !== 'gitWorktree' || descriptor.service !== 'gitWorktree') fail(`invalid Remote identity for ${descriptor.method}`)
  if (descriptor.result?.mode !== 'strict' || !descriptor.result.schema?._zod) fail(`Remote ${descriptor.method} result lacks a Zod v4 strict codec`)
  for (const parameter of descriptor.parameters ?? []) {
    if (parameter.codec?.mode !== 'strict' || !parameter.codec.schema?._zod) fail(`Remote ${descriptor.method}/${parameter.wire} lacks a Zod v4 strict codec`)
  }
}
ok(`manual strict ./typert + ./remote contribution (${expectedRemoteMethods.length} methods)`)

// 4. Host entry metadata required by the Cordis loader.
const entryRel = exportsMap['.']?.default ?? manifest.main
if (typeof entryRel !== 'string') fail('exports["."].default is not a path')
const entry = readFileSync(resolve(root, entryRel), 'utf8')
if (!/export\s+function\s+apply\b/.test(entry)) fail(`${entryRel} does not export function apply`)
if (!/export\s+const\s+inject\b/.test(entry)) fail(`${entryRel} does not export const inject`)
ok(`${entryRel} exports Host apply + inject`)

// 5. Browser ToolView declaration and executable ModuleLoader closure.
const client = manifest.dsh?.client
if (!client || client.platform !== 'web' || !Array.isArray(client.inject) || client.inject.length === 0) {
  fail('package.json must declare dsh.client { platform: "web", inject: [...] }')
}
const requiredClientPackages = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-api-gateway',
]
const missingClientPackages = requiredClientPackages.filter(name => !client.inject.includes(name))
if (missingClientPackages.length > 0) {
  fail(`package.json dsh.client.inject is missing: ${missingClientPackages.join(', ')}`)
}
const clientRel = exportsMap['./client']?.default
if (typeof clientRel !== 'string') fail('exports["./client"].default is required for dsh.client')
const clientSource = readFileSync(resolve(root, clientRel), 'utf8')
const browserRequires = [...clientSource.matchAll(/require\(["']([^"']+)["']\)/gu)].map(match => match[1])
const allowedBrowserRequires = new Set([
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
])
const unsupportedBrowserRequires = browserRequires.filter(specifier => !allowedBrowserRequires.has(specifier))
if (unsupportedBrowserRequires.length > 0) {
  fail(`${clientRel} requires modules absent from the browser ModuleLoader table: ${[...new Set(unsupportedBrowserRequires)].join(', ')}`)
}
const sandbox = {}
sandbox.window = sandbox
sandbox.globalThis = sandbox
let handoff
sandbox.__ModuleLoader__ = {
  load(value) {
    if (handoff !== undefined) fail('client bundle registered more than one ModuleLoader handoff')
    handoff = value
  },
}
try {
  vm.runInNewContext(clientSource, sandbox, { filename: clientRel })
} catch (error) {
  fail(`client bundle script failed before ModuleLoader registration: ${error instanceof Error ? error.message : String(error)}`)
}
if (!handoff || handoff.id !== manifest.name || typeof handoff.factory !== 'function') {
  fail(`client bundle must call window.__ModuleLoader__.load with id ${JSON.stringify(manifest.name)} and a factory`)
}
const browserRequire = (specifier) => {
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Modal: () => null, Menu: () => null }
  return require(specifier)
}
let clientExports
try {
  clientExports = handoff.factory(browserRequire)
} catch (error) {
  fail(`client bundle factory failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}
if (!clientExports || typeof clientExports.apply !== 'function' || !Array.isArray(clientExports.inject)) {
  fail('client bundle factory did not return apply + inject')
}
if (!clientExports.inject.includes('remote')) fail('client bundle must inject the official Remote service before $mount')
if (!clientExports.inject.includes('conversation')) fail('client bundle must inject the public conversation service for pre-session draft transfer')
ok(`${clientRel} registers ${manifest.name} through the browser ModuleLoader contract`)

// 6. Release CI and npm's prepublish lifecycle require committed source identity;
// local review builds intentionally run against a dirty managed Worktree.
const requireClean = process.env.CHECK_PUBLISH_REQUIRE_CLEAN === '1'
  || process.argv.includes('--require-clean')
if (requireClean) {
  let dirty = ''
  try { dirty = execSync('git status --porcelain --untracked-files=all', { cwd: root, encoding: 'utf8' }) } catch {}
  if (dirty.trim() !== '') fail(`working tree differs from HEAD:\n${dirty}`)
  ok('working tree matches HEAD')
} else {
  ok('Git cleanliness check deferred (set CHECK_PUBLISH_REQUIRE_CLEAN=1 for release CI)')
}

console.log('check-publish: all checks passed')
