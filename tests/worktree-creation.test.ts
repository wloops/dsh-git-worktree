import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createWorktree } from '../src/adapters/worktree-creation.js'
import { WorktreeCreationFailure } from '../src/creation-failure.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-create-'))
  roots.push(root)
  const repo = join(root, 'repo'), target = join(root, 'target')
  await mkdir(repo)
  const run = async (cwd: string, args: string[]) => {
    const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
    return { code: result.status ?? -1, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '', quiescent: true }
  }
  await run(repo, ['init', '-b', 'main'])
  await writeFile(join(repo, 'one.txt'), 'one\n')
  await writeFile(join(repo, 'two.txt'), 'two\n')
  await run(repo, ['add', '.'])
  await run(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'base'])
  const oid = (await run(repo, ['rev-parse', 'HEAD'])).stdout
  return { root, repo, target, run, oid }
}
it('creates a complete detached checkout and releases only its own creation lock', async () => {
  const { repo, target, run, oid } = await fixture()
  await createWorktree(repo, target, oid, run)
  expect(await readFile(join(target, 'two.txt'), 'utf8')).toBe('two\n')
  expect((await run(target, ['status', '--porcelain'])).stdout).toBe('')
  expect((await run(repo, ['worktree', 'list', '--porcelain'])).stdout).not.toContain('locked')
})
it('rolls back a partial checkout after confirmed exit and permits retry without touching Local', async () => {
  const { repo, target, run, oid } = await fixture()
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => {
    if (args[0] === 'checkout-index') {
      await run(cwd, ['checkout-index', 'one.txt'])
      return { code: -1, stdout: '', stderr: 'timeout', quiescent: true }
    }
    return run(cwd, args)
  }).catch(error => error)
  expect(failure).toBeInstanceOf(WorktreeCreationFailure)
  expect(failure.rolledBack, failure.message).toBe(true)
  expect(existsSync(target)).toBe(false)
  expect((await run(repo, ['worktree', 'list', '--porcelain'])).stdout.match(/worktree /g)).toHaveLength(1)
  expect((await run(repo, ['status', '--porcelain'])).stdout).toBe('')
  await createWorktree(repo, target, oid, run)
  expect(await readFile(join(target, 'one.txt'), 'utf8')).toBe('one\n')
})
it.each(['unknown', 'modified', 'index.lock', 'metadata-file', 'metadata-directory', 'initializing', 'unconfirmed'])('preserves %s rather than using force as deletion authority', async kind => {
  const { repo, target, run, oid } = await fixture()
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => {
    if (args[0] === 'checkout-index') {
      await run(cwd, ['checkout-index', 'one.txt'])
      if (kind === 'unknown') await writeFile(join(target, 'external.txt'), 'keep')
      if (kind === 'modified') await writeFile(join(target, 'one.txt'), 'external')
      if (['index.lock', 'metadata-file', 'metadata-directory', 'initializing'].includes(kind)) {
        const gitDir = (await run(cwd, ['rev-parse', '--absolute-git-dir'])).stdout
        if (kind === 'metadata-directory') {
          await mkdir(join(gitDir, 'external'))
          await writeFile(join(gitDir, 'external', 'keep'), 'external')
        } else if (kind === 'initializing') await writeFile(join(gitDir, 'locked'), 'initializing')
        else await writeFile(join(gitDir, kind === 'index.lock' ? 'index.lock' : 'external'), 'external-lock')
      }
      return { code: -1, stdout: '', stderr: 'timeout', quiescent: kind !== 'unconfirmed' }
    }
    return run(cwd, args)
  }).catch(error => error)
  expect(failure.rolledBack).toBe(false)
  expect(existsSync(target)).toBe(true)
  if (kind === 'unknown') expect(await readFile(join(target, 'external.txt'), 'utf8')).toBe('keep')
  if (kind === 'modified') expect(await readFile(join(target, 'one.txt'), 'utf8')).toBe('external')
})

it('does not repair another checkout while moving and removing a failed attempt', async () => {
  const { root, repo, target, run, oid } = await fixture()
  const other = join(root, 'other')
  await run(repo, ['worktree', 'add', '--detach', other, oid])
  await rm(join(other, '.git')) // Git for Windows marks this fixture file hidden.
  await writeFile(join(other, '.git'), 'gitdir: /nonexistent/foreign-pointer\n')
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => args[0] === 'checkout-index'
    ? { code: -1, stdout: '', stderr: 'timeout', quiescent: true } : run(cwd, args)).catch(error => error)
  expect(failure.rolledBack, failure.message).toBe(true)
  expect(await readFile(join(other, '.git'), 'utf8')).toBe('gitdir: /nonexistent/foreign-pointer\n')
})

it.each(['filter', 'gitlink'])('preserves hidden external data under %s rules', async kind => {
  const { repo, target, run } = await fixture()
  if (kind === 'filter') {
    await writeFile(join(repo, '.gitattributes'), '*.txt filter=strip\n')
    await run(repo, ['config', 'filter.strip.clean', "sed '/secret/d'"])
    await run(repo, ['config', 'filter.strip.smudge', 'cat'])
    await run(repo, ['add', '.gitattributes'])
  } else {
    const initial = (await run(repo, ['rev-parse', 'HEAD'])).stdout
    await run(repo, ['update-index', '--add', '--cacheinfo', `160000,${initial},sub`])
    await run(repo, ['config', 'diff.ignoreSubmodules', 'all'])
  }
  await run(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'special checkout'])
  const oid = (await run(repo, ['rev-parse', 'HEAD'])).stdout
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => {
    if (args[0] === 'checkout-index') {
      if (kind === 'filter') await writeFile(join(target, 'one.txt'), 'one\nsecret\n')
      else { await mkdir(join(target, 'sub')); await writeFile(join(target, 'sub', 'private'), 'keep') }
      return { code: -1, stdout: '', stderr: 'timeout', quiescent: true }
    }
    return run(cwd, args)
  }).catch(error => error)
  expect(failure.rolledBack).toBe(false)
  expect(await readFile(join(target, kind === 'filter' ? 'one.txt' : 'sub/private'), 'utf8')).toContain(kind === 'filter' ? 'secret' : 'keep')
})

it('preserves the file set of native worktree add for a sparse checkout', async () => {
  const { root, repo, target, run } = await fixture()
  await mkdir(join(repo, 'a')); await mkdir(join(repo, 'b'))
  await writeFile(join(repo, 'a', 'file'), 'a'); await writeFile(join(repo, 'b', 'file'), 'b')
  await run(repo, ['add', '.'])
  await run(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'directories'])
  await run(repo, ['sparse-checkout', 'set', 'a'])
  const oid = (await run(repo, ['rev-parse', 'HEAD'])).stdout
  const native = join(root, 'native')
  expect((await run(repo, ['worktree', 'add', '--detach', native, oid])).code).toBe(0)
  await createWorktree(repo, target, oid, run)
  expect((await run(target, ['ls-files', '-v'])).stdout).toBe((await run(native, ['ls-files', '-v'])).stdout)
  expect(existsSync(join(target, 'b', 'file'))).toBe(existsSync(join(native, 'b', 'file')))
  expect(existsSync(join(target, 'a', 'file'))).toBe(true)
})

it('removes only the exclusively claimed empty directory when registration fails without metadata', async () => {
  const { repo, target, run, oid } = await fixture()
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => args[0] === 'worktree' && args[1] === 'add'
    ? { code: -1, stdout: '', stderr: 'registration failed', quiescent: true } : run(cwd, args)).catch(error => error)
  expect(failure.rolledBack, failure.message).toBe(true)
  expect(existsSync(target)).toBe(false)
  expect((await run(repo, ['worktree', 'list', '--porcelain'])).stdout.match(/worktree /g)).toHaveLength(1)
})

it('refuses to remove a replacement directory at the original checkout path', async () => {
  const { rename } = await import('node:fs/promises')
  const { repo, target, run, oid } = await fixture()
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => {
    if (args[0] === 'checkout-index') {
      await rename(target, `${target}.original`)
      await mkdir(target)
      await writeFile(join(target, 'foreign'), 'keep')
      return { code: -1, stdout: '', stderr: 'timeout', quiescent: true }
    }
    return run(cwd, args)
  }).catch(error => error)
  expect(failure.rolledBack).toBe(false)
  expect(await readFile(join(target, 'foreign'), 'utf8')).toBe('keep')
  expect(existsSync(`${target}.original`)).toBe(true)
})

it.each(['unknown-directory', 'ignored-file', 'journal-failure', 'remove-failure'])('preserves residue on %s', async kind => {
  const { repo, target, run, oid } = await fixture()
  let latest: import('../src/ports.js').WorktreeCreationEvidence | undefined
  const failure = await createWorktree(repo, target, oid, async (cwd, args) => {
    if (args[0] === 'checkout-index') {
      if (kind === 'unknown-directory') await mkdir(join(target, 'external-empty'))
      if (kind === 'ignored-file') {
        await run(repo, ['config', 'core.excludesFile', join(repo, '.git', 'exclude-test')])
        await writeFile(join(repo, '.git', 'exclude-test'), 'external\n')
        await writeFile(join(target, 'external'), 'keep')
      }
      return { code: -1, stdout: '', stderr: 'timeout', quiescent: true }
    }
    if (kind === 'remove-failure' && args[0] === 'worktree' && args[1] === 'remove') {
      return { code: -1, stdout: '', stderr: 'locked by external process', quiescent: false }
    }
    return run(cwd, args)
  }, evidence => {
    if (kind === 'journal-failure' && evidence.quarantinePath) throw new Error('journal unavailable')
    latest = structuredClone(evidence)
  }).catch(error => error)
  expect(failure.rolledBack).toBe(false)
  expect(existsSync(latest!.root)).toBe(true)
  if (kind === 'ignored-file') expect(await readFile(join(target, 'external'), 'utf8')).toBe('keep')
  if (kind === 'remove-failure') expect(latest!.root).toBe(latest!.quarantinePath)
})
