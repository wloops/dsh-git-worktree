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
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { GitCheckoutSnapshot, SessionCheckoutGitPort } from '../ports.js'
import { SessionCheckoutError } from '../index.js'

/** Ordinary git commands keep a 10s cap; worktree removal gets 5 minutes on Windows. */
const GIT_COMMAND_TIMEOUT_MS = 30_000
const WORKTREE_REMOVE_TIMEOUT_MS = 5 * 60_000
/** Collected-output cap per stream; git output is small but removals can warn. */
const GIT_COLLECT_BYTES = 1 << 20

function gitTimeoutMs(args: readonly string[]): number {
  return args[0] === 'worktree' && args[1] === 'remove'
    ? WORKTREE_REMOVE_TIMEOUT_MS
    : GIT_COMMAND_TIMEOUT_MS
}

export interface GitPortOptions {
  /** Directory holding the empty `core.hooksPath` target; created by the caller. */
  hooksPath: string
}

interface GitCommandResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Run one git command through `ctx.subprocess`. Returns an outcome object —
 * the caller decides whether a non-zero exit is an error. Never
 * shell-interpreted; argv passes verbatim.
 */
async function runGit(ctx: Context, cwd: string, args: string[], options: GitPortOptions): Promise<GitCommandResult> {
  const graceMs = gitTimeoutMs(args)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), graceMs)
  timeout.unref?.()
  try {
    const handle: SubprocessHandle = ctx.subprocess.spawn({
      argv: [
        'git',
        '--no-pager',
        '--no-optional-locks',
        '-c', 'core.quotePath=false',
        '-c', 'core.fsmonitor=false',
        '-c', `core.hooksPath=${options.hooksPath}`,
        ...args,
      ],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: GIT_COLLECT_BYTES },
        stderr: { maxBytes: GIT_COLLECT_BYTES },
      },
      graceMs: GIT_COMMAND_TIMEOUT_MS,
      signal: controller.signal,
      env: {
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        LANG: 'C',
      },
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' || controller.signal.aborted) {
      return { code: -1, stdout, stderr: `git ${args.join(' ')} 超时（${graceMs}ms），已终止` }
    }
    return { code: outcome.exitCode ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (error) {
    // Synchronous spawn failure (git missing from PATH): report as a failed command.
    return { code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
  }
}

async function runGitChecked(ctx: Context, cwd: string, args: string[], options: GitPortOptions): Promise<string> {
  const result = await runGit(ctx, cwd, args, options)
  if (result.code !== 0) {
    throw new SessionCheckoutError(
      'git_operation_failed',
      `Git 操作失败: git ${args.join(' ')}${result.stderr ? `: ${result.stderr}` : ''}`,
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
    throw new SessionCheckoutError('invalid_input', '内部 Git artifact 名称无效')
  }
}

function internalArtifactRef(checkoutId: string, artifactName: string): string {
  assertArtifactName(artifactName)
  return `${checkoutRefRoot(checkoutId)}/${artifactName}`
}

function applyBaseRef(checkoutId: string): string {
  return internalArtifactRef(checkoutId, 'apply-base')
}

/** Build the `ctx.subprocess`-backed git port. */
export function createDshGitPort(ctx: Context, options: GitPortOptions): SessionCheckoutGitPort {
  const runSessionGit = (cwd: string, args: string[]) => runGit(ctx, cwd, args, options)
  const runSessionGitChecked = (cwd: string, args: string[]) => runGitChecked(ctx, cwd, args, options)

  return {
    inspect: async (root): Promise<GitCheckoutSnapshot | null> => {
      const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
      if (topLevel.code !== 0 || !topLevel.stdout) return null
      const commonDir = await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      const gitDir = await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'])
      const headOid = await runSessionGitChecked(root, ['rev-parse', 'HEAD'])
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
      if (topLevel.code !== 0 || !topLevel.stdout) return null
      return realpath(resolve(topLevel.stdout))
    },
    status: async (root) => {
      const output = await runSessionGitChecked(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      return { dirty: output.length > 0 }
    },
    createDetachedWorktree: async (localRoot, managedRoot, baseOid) => {
      await runSessionGitChecked(localRoot, ['worktree', 'add', '--detach', managedRoot, baseOid])
    },
    removeWorktree: async (localRoot, managedRoot) => {
      // Git treats a reviewed-but-uncommitted final snapshot as modified/untracked;
      // the caller has already verified checkout identity and the full fingerprint.
      await runSessionGitChecked(localRoot, ['worktree', 'remove', '--force', managedRoot])
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
      throw new SessionCheckoutError('git_operation_failed', result.stderr || '无法读取内部 Git artifact')
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
      throw new Error(result.stderr || '无法证明 Git commit ancestry')
    },
  }
}
