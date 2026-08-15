/**
 * dsh-git-worktree plugin entry. The session-checkout domain (state machine,
 * apply engine, ports) is Domi-ported and host-agnostic; this file is the DSH
 * plugin face: exports the domain error type, builds the DSH adapters, mounts
 * the state machine, and registers the model tools, `/worktree` command, and
 * session context note.
 * @module dsh-git-worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionCheckoutErrorCode } from './types.js'

/** Stable domain failure raised by the session-checkout state machine and its adapters. */
export class SessionCheckoutError extends Error {
  readonly code: SessionCheckoutErrorCode

  /**
   * @param code - stable error code from `SESSION_CHECKOUT_ERROR_CODES`.
   * @param message - user-facing message, surfaced verbatim by tools.
   */
  constructor(code: SessionCheckoutErrorCode, message: string) {
    super(message)
    this.name = 'SessionCheckoutError'
    this.code = code
  }
}
