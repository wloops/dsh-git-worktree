import { ProjectSkillStore, PROJECT_SKILL_ROOTS, hasDeliverableStatus, trackedSkillPaths } from './project-skills.js'
import { createWorktree } from './worktree-creation.js'
import { gitTimeoutMs, validateGitTimeouts, type GitTimeoutOptions } from './git-options.js'
import { initialCommitActions, type GitCommitProtocol } from './initial-commit.js'
import { hostMessage } from '../i18n/host.js'
/**
 * DSH adapter for the session-checkout git port: runs git through
 * `ctx.subprocess` (tree-scoped termination, bounded collected output,
 * scrubbed ambient environment) with Domi's hardening preserved — disabled
 * git hooks, no optional locks, no terminal prompts, C locale, and a 5-minute
 * hard cap for worktree removal on Windows. Internal refs use the
 * `refs/dsh-worktree/session-checkouts/<key>` namespace so plugin artifacts
 * never collide with user refs.
 * @module dsh-git-worktree/adapters/git
 */

import { createHash } from 'node:crypto'
import { realpath, lstat } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { GitCheckoutSnapshot, SessionCheckoutGitPort } from '../ports.js'
import { SessionCheckoutError } from '../index.js'

/** Termination grace is separate from the command deadline. */
const GIT_TERMINATION_GRACE_MS = 1_000
/** Collected-output cap per stream; git output is small but removals can warn. */
const GIT_COLLECT_BYTES = 1 << 20

export interface GitPortOptions extends GitTimeoutOptions {
  /** Directory holding the empty `core.hooksPath` target; created by the caller. */
  hooksPath: string
  projectSkills?: ProjectSkillStore
}

interface GitCommandResult {
  code: number
  stdout: string
  stderr: string
  /** Only true after the subprocess service confirmed whole-tree quiescence. */
  quiescent?: boolean
}

async function settleCreationTree(handle: SubprocessHandle): Promise<boolean> {
  if (typeof handle.waitForExit !== 'function' || typeof handle.terminate !== 'function') return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  timeout.unref?.()
  try {
    handle.terminate()
    return await handle.waitForExit(controller.signal)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Run one git command through `ctx.subprocess`. Returns an outcome object —
 * the caller decides whether a non-zero exit is an error. Never
 * shell-interpreted; argv passes verbatim.
 */
async function runGit(ctx: Context, cwd: string, args: string[], options: GitPortOptions, input?: string | GitCommitProtocol, creation?: { deadline: number }): Promise<GitCommandResult> {
  const graceMs = creation ? creation.deadline - Date.now() : gitTimeoutMs(args, options)
  if (creation && graceMs <= 0) return { code: -1, stdout: '', stderr: hostMessage('gitTimedOutMsAndWasTerminated', { p0: args.join(' '), p1: 0 }), quiescent: true }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), graceMs)
  timeout.unref?.()
  let handle: SubprocessHandle | undefined
  try {
    handle = ctx.subprocess.spawn({
      argv: [
        'git',
        '--no-pager',
        '--no-optional-locks',
        // Worktree prefixes can exceed MAX_PATH even when the source checkout fits.
        ...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []),
        '-c', 'core.quotePath=false',
        '-c', 'core.fsmonitor=false',
        '-c', `core.hooksPath=${options.hooksPath}`,
        ...args,
      ],
      cwd,
      stdio: {
        stdin: input === undefined ? 'ignore' : 'pipe',
        stdout: { maxBytes: GIT_COLLECT_BYTES },
        stderr: { maxBytes: GIT_COLLECT_BYTES },
      },
      graceMs: GIT_TERMINATION_GRACE_MS,
      signal: controller.signal,
      env: {
        // Repository routing must come from the authorized cwd, never ambient Git
        // overrides. Preserve identity variables and normal user configuration.
        ...Object.fromEntries(Object.keys(process.env).filter(key =>
          /^(GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_.*|CONFIG_VALUE_.*))$/i.test(key),
        ).map(key => [key, undefined])),
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        LANG: 'C',
      },
    })
    if (input !== undefined) {
      handle.stdin?.on('error', () => { /* Exit status reports a closed Git protocol pipe. */ })
      if (typeof input === 'string') handle.stdin?.end(input)
      else {
        handle.stdin?.write(input.prepare)
        let exited = false
        void handle.done.then(() => { exited = true })
        while (!exited && !controller.signal.aborted && !handle.collected.stdout?.readFrom(0).text.includes('prepare: ok')) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        if (!exited && !controller.signal.aborted) {
          try {
            await input.beforeCommit()
            handle.stdin?.end('commit\n')
          } catch (error) {
            handle.stdin?.end('abort\n')
            await handle.done
            throw error
          }
        } else handle.stdin?.end()
      }
    }
    const outcome = await handle.done
    let quiescent: boolean | undefined
    if (creation) {
      let completed = false
      if (outcome.exitCode === 0 && !outcome.signal && !controller.signal.aborted && typeof handle.waitForExit === 'function') {
        try { completed = await handle.waitForExit(controller.signal) } catch { /* Preserve unless termination is confirmed below. */ }
      }
      if (completed && !controller.signal.aborted) quiescent = true
      else {
        quiescent = await settleCreationTree(handle)
        if (outcome.exitCode === 0) return { code: -1, stdout: '', stderr: hostMessage('repositoryInspectionFailed'), quiescent }
      }
      if (!quiescent) return { code: -1, stdout: '', stderr: hostMessage('repositoryInspectionFailed'), quiescent: false }
    }
    clearTimeout(timeout)
    const stdoutRead = handle.collected.stdout?.readFrom(0)
    const stderrRead = handle.collected.stderr?.readFrom(0)
    const stdout = stdoutRead?.text ?? ''
    const stderr = stderrRead?.text ?? ''
    if (stdoutRead?.lossy || stderrRead?.lossy) {
      return { code: -1, stdout: '', stderr: hostMessage('repositoryInspectionFailed'), quiescent }
    }
    if (outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' || controller.signal.aborted) {
      return { code: -1, stdout, stderr: hostMessage('gitTimedOutMsAndWasTerminated', { p0: args.join(' '), p1: graceMs }), quiescent }
    }
    return { code: outcome.exitCode ?? -1, stdout: stdout.trim(), stderr: stderr.trim(), quiescent }
  } catch (error) {
    if (error instanceof SessionCheckoutError) throw error
    const quiescent = creation && handle ? await settleCreationTree(handle) : false
    return { code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error), quiescent }
  } finally {
    clearTimeout(timeout)
  }
}

async function runGitChecked(ctx: Context, cwd: string, args: string[], options: GitPortOptions): Promise<string> {
  const result = await runGit(ctx, cwd, args, options)
  if (result.code !== 0) {
    throw new SessionCheckoutError(
      'git_operation_failed',
      hostMessage('gitOperationFailedGit', { p0: args.join(' '), p1: result.stderr ? `: ${result.stderr}` : '' }),
    )
  }
  return result.stdout
}

function checkoutRefRoot(checkoutId: string): string {
  const key = createHash('sha256').update(checkoutId).digest('hex').slice(0, 24)
  return `refs/dsh-worktree/session-checkouts/${key}`
}

function assertArtifactName(artifactName: string): void {
  const segments = artifactName.split('/')
  if (
    segments.length === 0
    || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
  ) {
    throw new SessionCheckoutError('invalid_input', hostMessage('invalidInternalGitArtifactName'))
  }
}

function internalArtifactRef(checkoutId: string, artifactName: string): string {
  assertArtifactName(artifactName)
  return `${checkoutRefRoot(checkoutId)}/${artifactName}`
}

function applyBaseRef(checkoutId: string): string {
  return internalArtifactRef(checkoutId, 'apply-base')
}

async function hasGitMetadata(root: string): Promise<boolean> {
  let directory = resolve(root)
  for (;;) {
    try { await lstat(join(directory, '.git')); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true
    }
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}

/** Build the `ctx.subprocess`-backed git port. */
export function createDshGitPort(ctx: Context, options: GitPortOptions): SessionCheckoutGitPort {
  validateGitTimeouts(options)
  const projectSkills = options.projectSkills ?? new ProjectSkillStore(join(dirname(options.hooksPath), 'project-skills'))
  const runSessionGit = (cwd: string, args: string[], input?: string | GitCommitProtocol) => runGit(ctx, cwd, args, options, input)
  const runSessionGitChecked = (cwd: string, args: string[]) => runGitChecked(ctx, cwd, args, options)

  const port: SessionCheckoutGitPort = {
    inspect: async (root): Promise<GitCheckoutSnapshot | null> => {
      const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
      if (topLevel.code !== 0 || !topLevel.stdout) {
        if (topLevel.code === 128 && /^fatal: not a git repository/.test(topLevel.stderr) && !await hasGitMetadata(root)) return null
        throw new SessionCheckoutError('git_operation_failed', hostMessage('repositoryInspectionFailed'))
      }
      // Both paths come from the same fresh Git invocation. Do not cache across
      // operations: the worktree/common-directory identity is a safety boundary.
      const paths = (await runSessionGitChecked(root, [
        'rev-parse', '--path-format=absolute', '--git-common-dir', '--absolute-git-dir',
      ])).split('\n')
      // Newlines are legal in POSIX paths; retain the unambiguous single-value
      // reads when the multi-value output cannot be parsed safely.
      const commonDir = paths.length === 2 ? paths[0]!
        : await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      const gitDir = paths.length === 2 ? paths[1]!
        : await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'])
      const head = await runSessionGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
      let headOid = head.stdout
      if (head.code !== 0) {
        const symbolicHead = await runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
        const refs = await runSessionGit(root, ['show-ref'])
        // A missing commit is unborn only with a valid symbolic HEAD and no refs.
        // Broken refs, unreadable metadata, and missing objects remain Git errors.
        if (head.code !== 1 || symbolicHead.code !== 0 || !symbolicHead.stdout.startsWith('refs/heads/')
          || refs.code !== 1 || refs.stdout || refs.stderr) {
          throw new SessionCheckoutError('git_operation_failed', hostMessage('repositoryInspectionFailed'))
        }
        headOid = 'unborn'
      }
      const symbolic = await runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
      const headRef = symbolic.code === 0 && symbolic.stdout ? symbolic.stdout : 'HEAD'
      const branch = headRef.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : null
      return {
        root: await realpath(resolve(topLevel.stdout)),
        commonDir: await realpath(resolve(commonDir)),
        gitDir: await realpath(resolve(gitDir)),
        branch,
        headOid,
        headRef,
      }
    },
    findContainingWorktreeRoot: async (root) => {
      const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
      if (topLevel.code !== 0 || !topLevel.stdout) {
        if (topLevel.code === 128 && /^fatal: not a git repository/.test(topLevel.stderr) && !await hasGitMetadata(root)) return null
        throw new SessionCheckoutError('git_operation_failed', hostMessage('repositoryInspectionFailed'))
      }
      return realpath(resolve(topLevel.stdout))
    },
    status: async (root) => {
      const output = await runSessionGitChecked(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      const carried = await projectSkills.scope(root)
      return { dirty: hasDeliverableStatus(output, new Set(carried?.paths ?? []), carried?.directories) }
    },
    createDetachedWorktree: async (localRoot, managedRoot, baseOid, saveEvidence) => {
      const skills = await projectSkills.snapshot(localRoot)
      const changed = await runSessionGitChecked(localRoot, ['diff', '--name-only', '-z', baseOid, '--', ...PROJECT_SKILL_ROOTS])
        + await runSessionGitChecked(localRoot, ['diff', '--cached', '--name-only', '-z', baseOid, '--', ...PROJECT_SKILL_ROOTS])
      if (changed) throw new SessionCheckoutError('git_operation_failed', `Project Skills: commit or resolve local tracked Skill changes before creating a Worktree (${changed.split('\0').filter(Boolean).join(', ')})`)
      const deadline = Date.now() + gitTimeoutMs(['worktree', 'add'], options)
      await createWorktree(localRoot, managedRoot, baseOid,
        (cwd, args, creating) => runGit(ctx, cwd, args, options, undefined, creating ? { deadline }
          : args[0] === 'worktree' && ['move', 'remove'].includes(args[1] ?? '')
            ? { deadline: Date.now() + gitTimeoutMs(args, options) } : undefined),
        saveEvidence)
      await projectSkills.carry(skills, managedRoot)
    },
    removeWorktree: async (localRoot, managedRoot) => {
      // Git treats a reviewed-but-uncommitted final snapshot as modified/untracked;
      // the caller has already verified checkout identity and the full fingerprint.
      if (await projectSkills.paths(managedRoot)) {
        const index = await runSessionGitChecked(managedRoot, ['ls-files', '--stage', '-z'])
        const head = await runSessionGitChecked(managedRoot, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'])
        await projectSkills.assertRemovable(managedRoot, trackedSkillPaths(index, head))
      }
      await runSessionGitChecked(localRoot, ['worktree', 'remove', '--force', managedRoot])
      await projectSkills.forget(managedRoot)
    },
    retainApplyBase: async (localRoot, checkoutId, oid) => {
      await runSessionGitChecked(localRoot, ['update-ref', applyBaseRef(checkoutId), oid])
    },
    releaseApplyBase: async (localRoot, checkoutId) => {
      await runSessionGitChecked(localRoot, ['update-ref', '-d', applyBaseRef(checkoutId)])
    },
    retainInternalArtifact: async (localRoot, checkoutId, artifactName, oid) => {
      await runSessionGitChecked(localRoot, ['update-ref', internalArtifactRef(checkoutId, artifactName), oid])
    },
    readInternalArtifact: async (localRoot, checkoutId, artifactName) => {
      const result = await runSessionGit(localRoot, ['rev-parse', '--verify', '--quiet', internalArtifactRef(checkoutId, artifactName)])
      if (result.code === 0 && result.stdout) return result.stdout
      if (result.code === 1) return null
      throw new SessionCheckoutError('git_operation_failed', result.stderr || hostMessage('cannotReadTheInternalGitArtifact'))
    },
    releaseInternalArtifacts: async (localRoot, checkoutId, artifactPrefix) => {
      const prefix = artifactPrefix
        ? internalArtifactRef(checkoutId, artifactPrefix)
        : `${checkoutRefRoot(checkoutId)}/`
      const output = await runSessionGitChecked(localRoot, ['for-each-ref', '--format=%(refname)', prefix])
      const refs = output.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean)
      for (const ref of refs) await runSessionGitChecked(localRoot, ['update-ref', '-d', ref])
    },
    isAncestor: async (root, ancestorOid, descendantOid) => {
      const result = await runSessionGit(root, ['merge-base', '--is-ancestor', ancestorOid, descendantOid])
      if (result.code === 0) return true
      if (result.code === 1) return false
      throw new Error(result.stderr || hostMessage('cannotProveGitCommitAncestry'))
    },
  }
  return Object.assign(port, initialCommitActions(port.inspect, runSessionGit))
}
