import { createHash } from 'node:crypto'
import { lstat, open, readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitCheckoutSnapshot, InitialCommitPreflight } from '../ports.js'
import { SessionCheckoutError } from '../index.js'
import { hostMessage } from '../i18n/host.js'

export interface GitCommitProtocol { prepare: string; beforeCommit(): Promise<void> }

type Run = (root: string, args: string[], input?: string | GitCommitProtocol) => Promise<{ code: number; stdout: string; stderr: string }>

/** Only the Console's confirmed host action calls initialize; normal Git inspection is read-only. */
export function initialCommitActions(inspect: (root: string) => Promise<GitCheckoutSnapshot | null>, run: Run) {
  const stale = () => new SessionCheckoutError('stale_local', hostMessage('initialStateChanged'))
  async function checked(root: string, args: string[], input?: string | GitCommitProtocol): Promise<string> {
    const result = await run(root, args, input)
    if (result.code !== 0) throw new SessionCheckoutError('git_operation_failed', hostMessage('initialCommitFailed'))
    return result.stdout
  }
  async function identity(path: string, trackChanges = false): Promise<string> {
    const stat = await lstat(path, { bigint: true })
    if (stat.isSymbolicLink()) throw stale()
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}${trackChanges ? `:${stat.mtimeNs}:${stat.ctimeNs}` : ''}`
  }
  async function indexBytes(gitDir: string): Promise<string> {
    try { return (await readFile(join(gitDir, 'index'))).toString('base64') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
  }
  async function preflightInitialCommit(root: string): Promise<InitialCommitPreflight> {
    const snapshot = await inspect(root)
    if (snapshot === null) throw new SessionCheckoutError('not_git_repository', hostMessage('repositoryInspectionFailed'))
    if (snapshot.headOid !== 'unborn') return { kind: 'ready', fingerprint: '', snapshot }
    const entries = await readdir(snapshot.root)
    // Filesystem enumeration deliberately ignores no patterns: ignored files, symlinks,
    // nested repositories and empty directories all require an explicit user decision.
    const files = entries.filter(name => name !== '.git')
    const index = await checked(root, ['ls-files', '--stage', '-z'])
    if (files.length || index) return { kind: 'files', fingerprint: '', snapshot }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      snapshot, rootIdentity: await identity(root, true), canonicalIdentity: await identity(snapshot.root, true),
      gitIdentity: await identity(snapshot.gitDir), commonIdentity: await identity(snapshot.commonDir),
      head: (await readFile(join(snapshot.gitDir, 'HEAD'))).toString('base64'),
      headIdentity: await identity(join(snapshot.gitDir, 'HEAD'), true),
      index: await indexBytes(snapshot.gitDir), files: files.sort(),
    })).digest('hex')
    return { kind: 'empty', fingerprint, snapshot }
  }
  async function initializeEmptyRepository(root: string, fingerprint: string, assertAuthorized?: () => Promise<void>): Promise<string> {
    const before = await preflightInitialCommit(root)
    if (before.kind !== 'empty' || before.fingerprint !== fingerprint) throw stale()
    const locks: { path: string; handle: Awaited<ReturnType<typeof open>> }[] = []
    try {
      // The index lock excludes cooperating index writers and other initializers;
      // the ref transaction below locks HEAD. Never remove a lock we did not create.
      for (const name of ['index.lock']) {
        const path = join(before.snapshot.gitDir, name)
        locks.push({ path, handle: await open(path, 'wx') })
      }
      const current = await preflightInitialCommit(root)
      if (current.kind !== 'empty' || current.fingerprint !== fingerprint) throw stale()
      await assertAuthorized?.()
      for (const variable of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
        const ident = await run(root, ['-c', 'user.useConfigOnly=true', 'var', variable])
        if (ident.code !== 0) throw new SessionCheckoutError('git_operation_failed', hostMessage('initialIdentityMissing'))
      }
      // mktree with an empty stdin creates the empty tree without touching the index.
      const tree = await checked(root, ['mktree'])
      const oid = await checked(root, ['-c', 'user.useConfigOnly=true', 'commit-tree', tree, '-m', 'Initial commit'])
      const latest = await preflightInitialCommit(root)
      if (latest.kind !== 'empty' || latest.fingerprint !== fingerprint) throw stale()
      // Compare-and-swap the previously unborn branch; never overwrite a racing commit.
      // Git prepares the HEAD update and locks HEAD plus the resolved branch. Only
      // after rechecking under those locks may the transaction publish the commit.
      await checked(root, ['update-ref', '--stdin'], {
        prepare: `start
update HEAD ${oid} ${'0'.repeat(oid.length)}
prepare
`,
        async beforeCommit() {
          const locked = await preflightInitialCommit(root)
          if (locked.kind !== 'empty' || locked.fingerprint !== fingerprint) throw stale()
          await assertAuthorized?.()
        },
      })
      return oid
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new SessionCheckoutError('operation_not_allowed', hostMessage('initialRepositoryBusy'))
      }
      throw error
    } finally {
      for (const lock of locks.reverse()) {
        await lock.handle.close()
        await unlink(lock.path)
      }
    }
  }
  return { preflightInitialCommit, initializeEmptyRepository }
}
