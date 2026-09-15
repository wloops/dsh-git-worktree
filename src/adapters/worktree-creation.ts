import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rmdir, readlink } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import type { WorktreeCreationEvidence } from '../ports.js'
import { WorktreeCreationFailure } from '../creation-failure.js'
import { createNodeFilesPort } from './files.js'

type Result = { code: number; stdout: string; stderr: string; quiescent?: boolean }
type Run = (cwd: string, args: string[], creating?: boolean) => Promise<Result>
const files = createNodeFilesPort()
const samePath = (a: string, b: string) => process.platform === 'win32'
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
const sameIdentity = (a: unknown, b: unknown) => a !== null && JSON.stringify(a) === JSON.stringify(b)

/** Registration is short; the expensive checkout runs only after its ownership proof is durable. */
export async function createWorktree(localRoot: string, target: string, baseOid: string, run: Run,
  saveEvidence: (evidence: WorktreeCreationEvidence) => void = () => {}): Promise<void> {
  let evidence: WorktreeCreationEvidence | undefined
  let failure: Result | undefined
  let registered = false
  let claimed = false
  let originalMetadata: string[] = []
  const checked = async (cwd: string, args: string[], creating = true) => {
    const result = await run(cwd, args, creating)
    if (result.code !== 0) { failure = result; throw new Error(result.stderr || `git ${args.join(' ')} failed`) }
    return result.stdout
  }
  try {
    const commonDir = await realpath(await checked(localRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
    const parent = await realpath(dirname(target))
    if (!samePath(parent, dirname(target))) throw new Error('Worktree parent path changed')
    const parentIdentity = await files.inspectDirectoryIdentity(parent)
    const commonIdentity = await files.inspectDirectoryIdentity(commonDir)
    if (!parentIdentity || !commonIdentity) throw new Error('Worktree parent identity cannot be verified')
    try { originalMetadata = (await readdir(join(commonDir, 'worktrees'))).sort() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await mkdir(target) // Exclusive: an existing directory, including an empty one, is not this attempt's.
    claimed = true
    const rootIdentity = await files.inspectDirectoryIdentity(target)
    if (!rootIdentity) throw new Error('Worktree directory identity cannot be verified')
    evidence = { root: target, rootIdentity, parentIdentity, commonDir, commonIdentity, lockReason: `dsh-create-${randomUUID()}` }
    saveEvidence(evidence)
    await checked(localRoot, ['worktree', 'add', '--detach', '--no-checkout', '--lock', '--reason', evidence.lockReason, target, baseOid])
    const gitDir = await realpath(await checked(target, ['rev-parse', '--absolute-git-dir']))
    const gitIdentity = await files.inspectDirectoryIdentity(gitDir)
    if (!gitIdentity) throw new Error('Worktree metadata identity cannot be verified')
    evidence = { ...evidence, gitDir, gitIdentity, metadataFingerprint: await metadataFingerprint(gitDir) }
    saveEvidence(evidence)
    registered = true
    await verifyIdentity(evidence, baseOid)
    // read-tree publishes a complete index before any worktree file is written.
    // checkout-index without -f never overwrites a file supplied by another writer.
    const sparse = await checked(target, ['config', '--bool', '--get', 'core.sparseCheckout']).catch(error => {
      if (failure?.code === 1) { failure = undefined; return 'false' }
      throw error
    })
    if (sparse === 'true') {
      // Match native worktree add's sparse checkout semantics. A failed reset
      // may retain an index lock and therefore cannot be automatically removed.
      await checked(target, ['reset', '--hard', '--no-recurse-submodules', baseOid])
    } else {
      await checked(target, ['read-tree', baseOid])
      evidence = { ...evidence, indexFingerprint: createHash('sha256').update(await readFile(join(gitDir, 'index'))).digest('hex') }
      await saveEvidence(evidence)
      await checked(target, ['checkout-index', '--all'])
    }
    await verifyIdentity(evidence, baseOid)
    await checked(localRoot, ['worktree', 'unlock', target])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!claimed) throw new WorktreeCreationFailure(message, true)
    if (evidence && !registered && failure?.quiescent === true) {
      try {
        const listed = await run(localRoot, ['worktree', 'list', '--porcelain', '-z'])
        let metadata: string[] = []
        try { metadata = (await readdir(join(evidence.commonDir, 'worktrees'))).sort() }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const registeredRoot = listed.stdout.split('\0').some(part => part.startsWith('worktree ') && samePath(part.slice(9), target))
        if (listed.code === 0 && !registeredRoot && JSON.stringify(metadata) === JSON.stringify(originalMetadata)
          && sameIdentity(await files.inspectDirectoryIdentity(target), evidence.rootIdentity)
          && sameIdentity(await files.inspectDirectoryIdentity(dirname(target)), evidence.parentIdentity)
          && sameIdentity(await files.inspectDirectoryIdentity(evidence.commonDir), evidence.commonIdentity)
          && (await readdir(target)).length === 0) {
          await rmdir(target)
          throw new WorktreeCreationFailure(message, true)
        }
      } catch (cleanupError) {
        if (cleanupError instanceof WorktreeCreationFailure) throw cleanupError
      }
    }
    // A timeout in registration (including Git's initializing/index locks), a lost
    // process-tree observation or missing durable identity is never deletion authority.
    if (evidence && registered && failure?.quiescent === true) {
      try {
        await verifyIdentity(evidence, baseOid)
        await verifyRollbackMetadata(evidence, baseOid)
        await verifyUnmodified(evidence.root, baseOid, run)
        const quarantinePath = `${target}.failed-${randomUUID()}`
        evidence = { ...evidence, quarantinePath }
        saveEvidence(evidence)
        // Unlike worktree repair (which also scans other registrations), move
        // updates only this checkout's backlink and keeps its directory object.
        const moved = await run(localRoot, ['worktree', 'move', '--force', '--force', target, quarantinePath])
        if (moved.code !== 0) throw new Error(moved.stderr)
        evidence = { ...evidence, root: quarantinePath, indexFingerprint: createHash('sha256').update(await readFile(join(evidence.gitDir!, 'index'))).digest('hex') }
        saveEvidence(evidence)
        await verifyIdentity(evidence, baseOid)
        await verifyRollbackMetadata(evidence, baseOid)
        await verifyUnmodified(quarantinePath, baseOid, run)
        await verifyIdentity(evidence, baseOid)
        await verifyRollbackMetadata(evidence, baseOid)
        const removed = await run(localRoot, ['worktree', 'remove', '--force', '--force', quarantinePath])
        if (removed.code !== 0) throw new Error(removed.stderr)
        if (files.exists(quarantinePath) || files.exists(evidence.gitDir!)) throw new Error('Worktree rollback incomplete')
        throw new WorktreeCreationFailure(message, true)
      } catch (rollbackError) {
        if (rollbackError instanceof WorktreeCreationFailure) throw rollbackError
        throw new WorktreeCreationFailure(`${message}; ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, false)
      }
    }
    throw new WorktreeCreationFailure(`${message}${evidence?.quarantinePath ? ` (${evidence.quarantinePath})` : ''}`, false)
  }
}

async function verifyIdentity(e: WorktreeCreationEvidence, baseOid: string): Promise<void> {
  const fail = () => { throw new Error('Failed creation identity changed; residue preserved') }
  if (!e.gitDir || !e.gitIdentity) return fail()
  if (!sameIdentity(await files.inspectDirectoryIdentity(e.root), e.rootIdentity)
    || !sameIdentity(await files.inspectDirectoryIdentity(dirname(e.root)), e.parentIdentity)
    || !sameIdentity(await files.inspectDirectoryIdentity(e.commonDir), e.commonIdentity)
    || !sameIdentity(await files.inspectDirectoryIdentity(e.gitDir), e.gitIdentity)) return fail()
  const child = relative(join(e.commonDir, 'worktrees'), e.gitDir)
  if (!child || child.includes('..') || isAbsolute(child) || child.includes('/') || child.includes('\\')) return fail()
  const text = async (path: string) => {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return fail()
    return (await readFile(path, 'utf8')).trim()
  }
  const pointer = await text(join(e.root, '.git'))
  if (!pointer.startsWith('gitdir: ') || !samePath(resolve(e.root, pointer.slice(8)), e.gitDir)
    || !samePath(await text(join(e.gitDir, 'gitdir')), join(e.root, '.git'))
    || !samePath(resolve(e.gitDir, await text(join(e.gitDir, 'commondir'))), e.commonDir)
    || await text(join(e.gitDir, 'HEAD')) !== baseOid
    || await text(join(e.gitDir, 'locked')) !== e.lockReason) return fail()
  // Never break an index lock, including an interrupted read-tree's lock.
  if ((await readdir(e.gitDir)).some(name => name.endsWith('.lock'))) return fail()
}

async function verifyRollbackMetadata(e: WorktreeCreationEvidence, baseOid: string): Promise<void> {
  if (!e.gitDir || !e.metadataFingerprint || await metadataFingerprint(e.gitDir) !== e.metadataFingerprint) throw new Error('Creation metadata changed')
  if (!e.indexFingerprint || createHash('sha256').update(await readFile(join(e.gitDir, 'index'))).digest('hex') !== e.indexFingerprint) throw new Error(`Creation index bytes changed at ${e.root}`)
  for (const name of ['index', 'ORIG_HEAD']) {
    try {
      const path = join(e.gitDir, name), stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected creation metadata object')
      if (name === 'ORIG_HEAD' && (await readFile(path, 'utf8')).trim() !== baseOid) throw new Error('Creation ORIG_HEAD changed')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}

async function metadataFingerprint(gitDir: string): Promise<string> {
  const hash = createHash('sha256')
  async function walk(path: string, prefix = ''): Promise<void> {
    for (const name of (await readdir(path)).sort()) {
      // Git updates these during checkout or single-target move. Their semantic
      // contents and pointer are checked separately; every other byte is immutable.
      if (!prefix && ['index', 'gitdir', 'ORIG_HEAD'].includes(name)) continue
      const entry = join(path, name)
      const stat = await lstat(entry)
      const key = `${prefix}${name}`
      const allowed = stat.isDirectory() ? ['refs', 'logs', 'info'] : ['HEAD', 'commondir', 'locked', 'config.worktree', 'logs/HEAD', 'info/sparse-checkout']
      if (!allowed.includes(key)) throw new Error('Unknown creation metadata')
      hash.update(`${key}\0`)
      if (stat.isSymbolicLink()) throw new Error('Unexpected metadata symlink')
      if (stat.isDirectory()) { hash.update('directory\0'); await walk(entry, `${prefix}${name}/`) }
      else if (stat.isFile() && stat.size <= 1_048_576) { hash.update(`file:${stat.size}\0`); hash.update(await readFile(entry)) }
      else throw new Error('Unexpected metadata object')
    }
  }
  await walk(gitDir)
  return hash.digest('hex')
}

async function verifyUnmodified(root: string, baseOid: string, run: Run): Promise<void> {
  const checked = async (args: string[]) => {
    const result = await run(root, args)
    if (result.code !== 0) throw new Error(result.stderr)
    return result.stdout
  }
  // The complete index must still equal the authorized base. No skip-worktree / assume-unchanged shortcuts.
  const entries = await checked(['ls-files', '--stage', '-z'])
  if (entries.split('\0').some(line => line.startsWith('160000 '))) throw new Error('Submodule creation residue must be preserved')
  // Clean filters and working-tree encodings may discard bytes while comparing.
  // Such a semantic comparison cannot authorize deleting a failed checkout.
  const paths = entries.split('\0').filter(Boolean).map(line => line.slice(line.indexOf('\t') + 1))
  const tracked = new Set(paths)
  const directories = new Set<string>()
  for (const path of paths) {
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'))
  }
  const inspectEntries = async (directory: string, prefix = ''): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!prefix && entry.name === '.git') continue
      const path = `${prefix}${entry.name}`
      if (entry.isDirectory()) {
        if (!directories.has(path)) throw new Error('Unknown creation directory; preserved')
        await inspectEntries(join(directory, entry.name), `${path}/`)
      } else if (!tracked.has(path)) throw new Error('Unknown creation contents; preserved')
    }
  }
  await inspectEntries(root)
  for (let i = 0; i < paths.length; i += 100) {
    const attributes = await checked(['check-attr', '-z', 'filter', 'working-tree-encoding', '--', ...paths.slice(i, i + 100)])
    const fields = attributes.split('\0')
    for (let j = 2; j < fields.length; j += 3) {
      if (fields[j] !== 'unspecified' && fields[j] !== 'unset') throw new Error('Checkout conversions require preservation')
    }
  }
  for (const line of entries.split('\0').filter(Boolean)) {
    const match = /^(\d+) ([0-9a-f]+) 0\t([\s\S]+)$/.exec(line)
    if (!match) throw new Error('Unexpected creation index entry')
    const [, mode, oid, path] = match
    const absolute = resolve(root, path!)
    if (!absolute.startsWith(`${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Invalid checkout path')
    try {
      const stat = await lstat(absolute)
      const hash = createHash(oid!.length === 64 ? 'sha256' : 'sha1')
      if (mode === '120000' && stat.isSymbolicLink()) {
        const bytes = Buffer.from(await readlink(absolute))
        hash.update(`blob ${bytes.length}\0`).update(bytes)
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        hash.update(`blob ${stat.size}\0`)
        let size = 0
        for await (const chunk of createReadStream(absolute)) { hash.update(chunk); size += chunk.length }
        if (size !== stat.size) throw new Error('Checkout file changed while checking')
      } else throw new Error('Unexpected checkout filesystem object')
      if (hash.digest('hex') !== oid) throw new Error('Checkout bytes require preservation')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const staged = await checked(['diff-index', '--cached', '--name-only', baseOid, '--'])
  const flags = await checked(['ls-files', '-v', '-z'])
  if (staged || flags.split('\0').some(line => line && !line.startsWith('H '))) throw new Error(`Creation index entries changed: ${staged} / ${flags}`)
  const unknown = await checked(['ls-files', '--others', '-z']) // includes ignored files
  const changed = await checked(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', baseOid, '--'])
  if (unknown) throw new Error('Unknown creation contents; preserved')
  const parts = changed.split('\0').filter(Boolean)
  for (let i = 0; i < parts.length; i += 2) if (parts[i] !== 'D' || !parts[i + 1]) throw new Error('Modified creation contents; preserved')
}
