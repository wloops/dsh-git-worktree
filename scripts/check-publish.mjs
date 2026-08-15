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
import { fileURLToPath } from 'node:url'
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

// 3. Host entry metadata required by the Cordis loader.
const entryRel = exportsMap['.']?.default ?? manifest.main
if (typeof entryRel !== 'string') fail('exports["."].default is not a path')
const entry = readFileSync(resolve(root, entryRel), 'utf8')
if (!/export\s+function\s+apply\b/.test(entry)) fail(`${entryRel} does not export function apply`)
if (!/export\s+const\s+inject\b/.test(entry)) fail(`${entryRel} does not export const inject`)
ok(`${entryRel} exports Host apply + inject`)

// 4. Browser ToolView declaration and executable ModuleLoader closure.
const client = manifest.dsh?.client
if (!client || client.platform !== 'web' || !Array.isArray(client.inject) || client.inject.length === 0) {
  fail('package.json must declare dsh.client { platform: "web", inject: [...] }')
}
const clientRel = exportsMap['./client']?.default
if (typeof clientRel !== 'string') fail('exports["./client"].default is required for dsh.client')
const clientSource = readFileSync(resolve(root, clientRel), 'utf8')
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
let clientExports
try {
  clientExports = handoff.factory(require)
} catch (error) {
  fail(`client bundle factory failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}
if (!clientExports || typeof clientExports.apply !== 'function' || !Array.isArray(clientExports.inject)) {
  fail('client bundle factory did not return apply + inject')
}
ok(`${clientRel} registers ${manifest.name} through the browser ModuleLoader contract`)

// 5. Release CI and npm's prepublish lifecycle require committed source identity;
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
