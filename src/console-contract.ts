/**
 * JSON-only shared contract for the future Harness-native Worktree Console.
 *
 * This module deliberately contains no Cordis, React, Remote or filesystem
 * implementation. Host and Client tracks share these DTOs while preserving one
 * authority rule: every Host operation resolves an exact caller Session and
 * re-validates project, owner, cwd, revision and review identity at execution.
 * @module dsh-git-worktree/console-contract
 */

import {
  SESSION_CHECKOUT_ERROR_CODES,
  type SessionCheckoutErrorCode,
  type SessionCheckoutPhase,
  type WorktreeRetentionMode,
  type WorktreeApplyPreflightView,
  type WorktreeAcceptanceBlockerView,
  type WorktreeDeliveryProofView,
  type WorktreeValidationItem,
  type WorktreeValidationStatus,
} from './types.js'

export const WORKTREE_CONSOLE_TARGET_STATES = [
  'local',
  'creating',
  'working',
  'ready_for_review',
  'preview_active',
  'preview_detached',
  'retained',
  'cleanup_pending',
  'recovery_required',
  'delivered',
] as const

export type WorktreeConsoleTargetState = typeof WORKTREE_CONSOLE_TARGET_STATES[number]

export type WorktreeConsoleDeliveryState =
  | 'working'
  | 'ready_for_review'
  | 'preview_active'
  | 'preview_detached'
  | 'finalized'
  | 'retained'
  | 'delivered'

/** Minimal domain facts required to project a stable, UI-facing state. */
export interface WorktreeConsoleProjectionSource {
  kind: 'local' | 'isolated'
  phase: SessionCheckoutPhase
  deliveryState?: WorktreeConsoleDeliveryState
}

/** Recovery and mutation phases take precedence over a stale delivery label. */
export function consoleStateFromDomain(source: WorktreeConsoleProjectionSource): WorktreeConsoleTargetState {
  if (source.kind === 'local') return 'local'
  if (source.phase === 'recovery_required') return 'recovery_required'
  if (source.phase === 'preparing') return 'creating'
  if (source.deliveryState === 'retained' || source.phase === 'retained') return 'retained'
  if (source.deliveryState === 'finalized' || source.phase === 'finalized') return 'cleanup_pending'
  if (source.deliveryState === 'delivered' || source.phase === 'discarded') return 'delivered'
  if (source.deliveryState === 'preview_detached') return 'preview_detached'
  if (source.deliveryState === 'preview_active') return 'preview_active'
  if (source.deliveryState === 'ready_for_review') return 'ready_for_review'
  return 'working'
}

export interface WorktreeConsoleProject {
  id: string
  name: string
}

export interface WorktreeConsoleCapabilities {
  create: boolean
  open: boolean
  inspect: boolean
  discard: boolean
  preflight: boolean
  preview: boolean
  /** Invalidate an unsynced review and resume the same iteration without touching Local. */
  resumeRevision: boolean
  rollbackPreview: boolean
  /** Direct Ready → Commit path that skips Local Preview. */
  finalize: boolean
  finalizePreview: boolean
  setRetention: boolean
  retryCleanup: boolean
  /** Recreate a cleaned delivered owner's immutable cwd for iteration + 1. */
  beginNextIteration: boolean
}

export interface WorktreeConsolePreviewRecovery {
  reason: 'stale_local' | 'preview_modified'
  attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'
}

export type WorktreeConsoleDeliveryProof = WorktreeDeliveryProofView

export interface WorktreeConsoleReviewSummary {
  reviewId: string
  revision: number
  iteration: number
  preparedAt: number
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  changedFiles: string[]
  suggestedCommitMessage: string
}

/** Path-free row safe for project lists and header status chips. */
export interface WorktreeConsoleTargetSummary {
  project: WorktreeConsoleProject
  checkoutId: string | null
  sourceSessionId: string
  ownerSessionId: string
  targetSessionId: string | null
  iteration: number
  revision: number
  state: WorktreeConsoleTargetState
  phase: SessionCheckoutPhase | 'local'
  dirty: boolean
  currentOid: string
  commitOid: string | null
  retention?: Exclude<WorktreeRetentionMode, 'cleanup'>
  retainedAt?: number
  expiresAt?: number | null
  cleanupMessage?: string
  deliveryProof?: WorktreeConsoleDeliveryProof
  review?: WorktreeConsoleReviewSummary
  reviewSlot?: 'available' | 'waiting'
  reviewSlotOwnerSessionId?: string
  reviewSlotHolder?: WorktreeAcceptanceBlockerView
  previewRecovery?: WorktreeConsolePreviewRecovery
  capabilities: WorktreeConsoleCapabilities
}

/** Identity-validated detail used only when the caller may open this target. */
export interface WorktreeConsoleTargetDetails extends WorktreeConsoleTargetSummary {
  managedRoot: string | null
  /** Host-validated canonical Local root used only for source Session navigation. */
  sourceRoot: string | null
  sourceOid: string
  currentBranch: string | null
  /** Owner-only Host proof for one explicitly authorized recovery continuation. */
  recoveryContinuation?: WorktreeRecoveryProof
}

export interface WorktreeConsoleCurrentRequest {
  sessionId: string
}

export interface WorktreeConsoleCurrentResponse {
  target: WorktreeConsoleTargetDetails
}

export interface WorktreeConsoleListRequest {
  sessionId: string
  needsAttention?: boolean
  includeDelivered?: boolean
}

export interface WorktreeConsoleListResponse {
  project: WorktreeConsoleProject
  worktrees: WorktreeConsoleTargetSummary[]
}

/** targetSessionId is allocated on the Host; the browser never chooses ownership identity. */
export interface WorktreeConsoleCreateRequest {
  sourceSessionId: string
}

export interface WorktreeConsoleCreateResponse {
  target: WorktreeConsoleTargetDetails
  targetSessionId: string
  managedRoot: string
}

export interface WorktreeConsoleInspectRequest {
  sessionId: string
  checkoutId: string
}

export interface WorktreeConsoleInspectResponse {
  target: WorktreeConsoleTargetDetails
}

export interface WorktreeConsoleDiscardRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  confirmDirty: boolean
  rollbackPreview?: boolean
}

export interface WorktreeConsolePreflightRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
}

export interface WorktreeConsolePreflightResponse {
  preflight: WorktreeApplyPreflightView
}

export interface WorktreeConsolePreviewRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
}

export interface WorktreeConsoleResumeRevisionRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
  /** Present only for the explicit conflict-recovery action; Host re-runs conflict preflight under CAS. */
  conflictContinuation?: WorktreeApplyConflictContinuation
}

export interface WorktreeConsoleRollbackPreviewRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  resumeRevision?: boolean
}

export interface WorktreeConsoleFinalizeRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
  /** Explicit user-confirmed message; Host revalidates the bounded value. */
  commitMessage: string
  retention: WorktreeRetentionMode
}

export interface WorktreeConsoleFinalizePreviewRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
  commitMessage: string
  retention: WorktreeRetentionMode
}

export interface WorktreeConsoleSetRetentionRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  retention: Exclude<WorktreeRetentionMode, 'cleanup'>
}

export interface WorktreeConsoleRetryCleanupRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
}

export interface WorktreeConsoleBeginNextIterationRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
}

export interface WorktreeConsoleMutationResponse {
  target: WorktreeConsoleTargetSummary
  changedFiles?: string[]
  commitOid?: string | null
  recoveryContinuation?: WorktreeRecoveryProof
}

export interface WorktreeConsolePrepareRegenerationRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
}

export type WorktreeConsoleFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary'

export interface WorktreeConsoleDiffFile {
  path: string
  previousPath?: string
  status: WorktreeConsoleFileStatus
  patch: string | null
  truncated: boolean
}

/** Review reads are bound to the same immutable identity required by Finalize. */
export interface WorktreeConsoleReviewDiffRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
}

export interface WorktreeConsoleReviewDiffResponse {
  reviewId: string
  revision: number
  files: WorktreeConsoleDiffFile[]
  truncated: boolean
}

export const WORKTREE_CONSOLE_ERROR_CODES = [
  ...SESSION_CHECKOUT_ERROR_CODES,
  'transport_unavailable',
  'malformed_response',
] as const

export type WorktreeConsoleErrorCode = SessionCheckoutErrorCode | 'transport_unavailable' | 'malformed_response'
export type WorktreeConsoleErrorCategory =
  | 'permission'
  | 'stale'
  | 'confirmation'
  | 'recovery'
  | 'conflict'
  | 'unavailable'
  | 'invalid'
  | 'internal'
export type WorktreeConsoleRecovery = 'none' | 'refresh' | 'confirm_dirty' | 'open_recovery' | 'retry'

export interface WorktreeApplyConflictContinuation {
  kind: 'worktree_apply_conflict'
  /** Stable identity for Client single-flight and retry within this renderer lifetime. */
  requestId: string
  checkoutId: string
  /** Review that remains Ready until the user explicitly resumes it for conflict resolution. */
  reviewId: string
  /** Authoritative revision after the failed real-time write attempt returned to Ready. */
  revision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface WorktreeApplyConflictRecoveryProof {
  kind: 'worktree_apply_conflict'
  requestId: string
  checkoutId: string
  reviewId: string
  /** Exact Working revision produced by the Host conflict-resume CAS. */
  revision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface WorktreeReviewRegenerationProof {
  kind: 'worktree_review_regeneration'
  requestId: string
  checkoutId: string
  reviewId: string
  revision: number
}

export type WorktreeRecoveryProof = WorktreeApplyConflictRecoveryProof | WorktreeReviewRegenerationProof
export type WorktreeConsoleContinuation = WorktreeApplyConflictContinuation

export interface WorktreeConsoleError {
  code: WorktreeConsoleErrorCode
  message: string
  details?: Record<string, string | number | boolean | null>
  continuation?: WorktreeConsoleContinuation
}

export type WorktreeConsoleOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorktreeConsoleError }

export interface WorktreeConsoleErrorMeta {
  category: WorktreeConsoleErrorCategory
  recovery: WorktreeConsoleRecovery
  retryable: boolean
}

const ERROR_META = {
  session_not_found: { category: 'unavailable', recovery: 'refresh', retryable: true },
  project_not_found: { category: 'unavailable', recovery: 'refresh', retryable: true },
  project_root_missing: { category: 'unavailable', recovery: 'open_recovery', retryable: false },
  not_git_repository: { category: 'invalid', recovery: 'none', retryable: false },
  target_unselected: { category: 'unavailable', recovery: 'refresh', retryable: true },
  target_already_bound: { category: 'invalid', recovery: 'refresh', retryable: true },
  project_mismatch: { category: 'permission', recovery: 'none', retryable: false },
  checkout_missing: { category: 'unavailable', recovery: 'refresh', retryable: true },
  checkout_mismatch: { category: 'permission', recovery: 'open_recovery', retryable: false },
  recovery_required: { category: 'recovery', recovery: 'open_recovery', retryable: false },
  registry_corrupt: { category: 'recovery', recovery: 'open_recovery', retryable: false },
  git_operation_failed: { category: 'internal', recovery: 'retry', retryable: true },
  not_owner: { category: 'permission', recovery: 'none', retryable: false },
  stale_target: { category: 'stale', recovery: 'refresh', retryable: true },
  dirty_confirmation_required: { category: 'confirmation', recovery: 'confirm_dirty', retryable: true },
  apply_conflict: { category: 'conflict', recovery: 'open_recovery', retryable: false },
  apply_failed: { category: 'internal', recovery: 'retry', retryable: true },
  invalid_input: { category: 'invalid', recovery: 'none', retryable: false },
  invalid_plan: { category: 'invalid', recovery: 'refresh', retryable: true },
  stale_local: { category: 'stale', recovery: 'refresh', retryable: true },
  stale_isolated: { category: 'stale', recovery: 'refresh', retryable: true },
  git_error: { category: 'internal', recovery: 'retry', retryable: true },
  commit_isolation_conflict: { category: 'conflict', recovery: 'open_recovery', retryable: false },
  checkout_limit_reached: { category: 'invalid', recovery: 'none', retryable: false },
  project_acceptance_busy: { category: 'conflict', recovery: 'retry', retryable: true },
  operation_not_allowed: { category: 'invalid', recovery: 'refresh', retryable: true },
  preview_not_active: { category: 'invalid', recovery: 'refresh', retryable: true },
  preview_modified: { category: 'stale', recovery: 'open_recovery', retryable: false },
  recovery_unsafe: { category: 'recovery', recovery: 'open_recovery', retryable: false },
  transport_unavailable: { category: 'unavailable', recovery: 'retry', retryable: true },
  malformed_response: { category: 'internal', recovery: 'none', retryable: false },
} as const satisfies Record<WorktreeConsoleErrorCode, WorktreeConsoleErrorMeta>

export function worktreeConsoleErrorMeta(code: WorktreeConsoleErrorCode): WorktreeConsoleErrorMeta {
  return ERROR_META[code]
}

/** Normalized Client seam; Remote transport details stay behind one adapter. */
export interface WorktreeConsoleAdapter {
  current(request: WorktreeConsoleCurrentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>>
  list(request: WorktreeConsoleListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>>
  create(request: WorktreeConsoleCreateRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>>
  inspect(request: WorktreeConsoleInspectRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>>
  reviewDiff(request: WorktreeConsoleReviewDiffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>>
  preflight(request: WorktreeConsolePreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>>
  preview(request: WorktreeConsolePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  resumeRevision(request: WorktreeConsoleResumeRevisionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  prepareReviewRegeneration(request: WorktreeConsolePrepareRegenerationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  rollbackPreview(request: WorktreeConsoleRollbackPreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  discard(request: WorktreeConsoleDiscardRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  finalize(request: WorktreeConsoleFinalizeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  finalizePreview(request: WorktreeConsoleFinalizePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  setRetention(request: WorktreeConsoleSetRetentionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  retryCleanup(request: WorktreeConsoleRetryCleanupRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  beginNextIteration(request: WorktreeConsoleBeginNextIterationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
}
