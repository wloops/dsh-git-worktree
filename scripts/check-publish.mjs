/**
 * Pre-publish integrity gate: fails the release if the package would install
 * but never mount. Catches the class of mistakes that shipped without a boot
 * test — 0.1.0 (no dsh.bundle declaration, no cordis.patch.yml in the
 * tarball) and 0.1.1 (inject not exported as plugin metadata). Every check
 * here maps to a real failure mode of `dsh plugin --profile <p> add <pkg>`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (message) => { console.error(`check-publish: FAIL: ${message}`); process.exit(1) }
const ok = (message) => console.log(`check-publish: ok: ${message}`)

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

// 1. The bundle declaration `dsh plugin` reconciles on. Without it the
//    package installs as a plain dependency and its plugin rows never enter
//    the profile composition ("installed, but nothing happens").
const patchRel = manifest.dsh?.bundle?.patch
if (typeof patchRel !== 'string' || patchRel.length === 0) {
  fail('package.json lacks "dsh".bundle.patch — dsh plugin add will install the package as a plain dependency and nothing mounts')
}
ok(`dsh.bundle.patch = ${patchRel}`)
if (!existsSync(resolve(root, patchRel))) fail(`declared patch file ${patchRel} does not exist`)

// 2. The patch file must reach the published tarball, or a registry install
//    of this exact version fails the same way.
const files = manifest.files ?? []
if (!files.includes(patchRel.replace(/^\.\//, ''))) fail(`${patchRel} is missing from "files" — the published tarball will not carry it`)
ok(`${patchRel} listed in "files"`)

// 3. The patch must insert a row naming this package — that row is what the
//    loader mounts at boot.
const patch = readFileSync(resolve(root, patchRel), 'utf8')
if (!patch.includes('- insert:')) fail(`${patchRel} does not contain an "- insert:" entry`)
if (!patch.includes(`name: ${manifest.name}`)) fail(`${patchRel} does not insert a row with name ${manifest.name}`)
ok(`${patchRel} inserts a row for ${manifest.name}`)

// 4. The entry must export BOTH "function apply" and "const inject" as named
//    exports: the loader reads named exports as plugin metadata. A bare
//    function export mounts with an empty injection list and the first
//    ctx.<service> access crashes the boot.
const entryRel = manifest.exports?.['.']?.default ?? manifest.main
if (typeof entryRel !== 'string' || entryRel.length === 0) fail('package.json exports["."].default is not a path')
if (!existsSync(resolve(root, entryRel))) fail(`entry ${entryRel} does not exist — run build first`)
const entry = readFileSync(resolve(root, entryRel), 'utf8')
if (!/export\s+function\s+apply\b/.test(entry)) fail(`${entryRel} does not export "function apply"`)
if (!/export\s+const\s+inject\b/.test(entry)) fail(`${entryRel} does not export "const inject" — the loader mounts with no injection list and crashes on the first ctx.<service> access`)
ok(`${entryRel} exports apply + inject`)

console.log('check-publish: all checks passed')
