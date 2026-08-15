import { SESSION_CHECKOUT_ERROR_CODES, type SessionCheckoutErrorCode } from '../types.js'
import type { WorktreeConsoleError, WorktreeConsoleOutcome } from '../console-contract.js'

export function domainError(code: SessionCheckoutErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export function consoleFailure(error: unknown): WorktreeConsoleOutcome<never> {
  if (
    error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && (SESSION_CHECKOUT_ERROR_CODES as readonly string[]).includes(error.code)
  ) {
    return { ok: false, error: { code: error.code as SessionCheckoutErrorCode, message: error.message } }
  }
  return {
    ok: false,
    error: {
      code: 'git_error',
      message: error instanceof Error ? error.message : 'Worktree Console 操作失败',
    },
  }
}

export function failure<T>(code: WorktreeConsoleError['code'], message: string, details?: WorktreeConsoleError['details']): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } }
}

export async function outcome<T>(operation: () => Promise<T>): Promise<WorktreeConsoleOutcome<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return consoleFailure(error)
  }
}
