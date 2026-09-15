export interface GitTimeoutOptions {
  gitTimeoutMs?: number
  worktreeAddTimeoutMs?: number
}

export const DEFAULT_GIT_TIMEOUT_MS = 120_000
export const DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000
export const MAX_GIT_TIMEOUT_MS = 60 * 60_000

export function validateGitTimeouts(options: GitTimeoutOptions): void {
  for (const key of ['gitTimeoutMs', 'worktreeAddTimeoutMs'] as const) {
    const value = options[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_GIT_TIMEOUT_MS)) {
      throw new RangeError(`${key} must be an integer between 1000 and ${MAX_GIT_TIMEOUT_MS} ms`)
    }
  }
}

export function gitTimeoutMs(args: readonly string[], options: GitTimeoutOptions): number {
  if (args[0] === 'worktree' && args[1] === 'add') return options.worktreeAddTimeoutMs ?? DEFAULT_WORKTREE_ADD_TIMEOUT_MS
  if (args[0] === 'worktree' && args[1] === 'remove') return 5 * 60_000
  return options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
}
