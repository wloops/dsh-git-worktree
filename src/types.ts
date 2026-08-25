/**
 * Type surface for dsh-git-worktree, ported from Domi's session-checkout
 * domain (`@proma/shared` types/session-target.ts). The plugin keeps Domi's
 * Local preview/rollback/finalize lifecycle while omitting collaborator and
 * Electron-only surfaces. Harness transport and Session separation live above
 * this host-agnostic state machine.
 * @module dsh-git-worktree/types
 */

/** Stable session-target reference in the durable layer. Paths and branches are not checkout identity. */
export type SessionTargetRef =
  | { kind: 'unselected' }
  | { kind: 'local' }
  | { kind: 'isolated'; checkoutId: string }

export type SessionCheckoutKind = 'local' | 'isolated'

export type SessionCheckoutPhase =
  | 'preparing'
  | 'ready'
  /** @deprecated v1 registry/runtime compatibility; new mutations use mutating. */
  | 'applying'
  | 'mutating'
  | 'recovery_required'
  | 'finalized'
  | 'retained'
  | 'discarded'

export type WorktreeValidationStatus = 'passed' | 'failed' | 'partial' | 'not_run'

/** cleanup is the default immediate removal; the other values only apply when the user explicitly retains the runtime. */
export type WorktreeRetentionMode = 'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual'

export type WorktreeCleanupReason =
  | 'directory_busy'
  | 'modified_after_finalize'
  | 'identity_changed'
  | 'detached_residue'
  | 'quarantine_busy'

export interface WorktreeValidationItem {
  command: string
  status: 'passed' | 'failed' | 'not_run'
  summary?: string
}

/** A saved stage that exists only in the managed Worktree history until final delivery. */
export interface WorktreeCheckpointView {
  checkpointId: string
  sequence: number
  reviewId: string
  createdAt: number
  summary: string
  validationStatus: WorktreeValidationStatus
  changedFiles: string[]
}

export interface WorktreeReviewView {
  reviewId: string
  iteration: number
  preparedAt: number
  /** Deterministically rendered full Markdown body before the acceptance card. Historical records may omit it. */
  detailsMarkdown?: string
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  changedFiles: string[]
  suggestedCommitMessage: string
}

export interface WorktreeDeliveryProofView {
  /** Local branch at commit time; null means detached and automatic finish rejects that state. */
  localBranch: string | null
  localHeadBefore: string
  localHeadAfter: string
  changedFiles: string[]
  /** Validation evidence copied from the exact Review that authorized this delivery. */
  validationStatus?: WorktreeValidationStatus
  validationSummary?: string
  /** Whether this round's commit is still an ancestor of Local HEAD at view time. null when there is no commit. */
  commitInLocalHistory: boolean | null
}

export type WorktreeDeliveryView =
  | { state: 'working'; iteration: number }
  | { state: 'ready_for_review'; review: WorktreeReviewView }
  | { state: 'preview_active'; review: WorktreeReviewView; previewedAt: number }
  | {
      state: 'preview_detached'
      review: WorktreeReviewView
      previewedAt: number
      detachedAt: number
      reason: 'stale_local' | 'preview_modified'
      attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'
    }
  | {
      state: 'finalized'
      review: WorktreeReviewView
      commitOid: string | null
      proof?: WorktreeDeliveryProofView
      cleanup: 'pending' | 'blocked'
      cleanupMessage?: string
    }
  | {
      state: 'retained'
      review: WorktreeReviewView
      commitOid: string | null
      proof?: WorktreeDeliveryProofView
      retention: Exclude<WorktreeRetentionMode, 'cleanup'>
      retainedAt: number
      expiresAt: number | null
      cleanup: 'scheduled' | 'blocked'
      cleanupMessage?: string
    }
  | { state: 'delivered'; iteration: number; commitOid: string | null; proof?: WorktreeDeliveryProofView; deliveredAt: number }

export type WorktreeApplyPreflightBlockedReason =
  | 'not_owner'
  | 'not_ready_for_review'
  | 'stale_target'
  | 'stale_local'
  | 'stale_isolated'
  | 'project_acceptance_busy'
  | 'checkout_unavailable'
  | 'git_error'

export interface WorktreeApplyPreflightFacts {
  checkoutId: string
  reviewId: string
  revision: number
  configuredBaseOid: string
  effectiveBaseOid: string
  baseStrategy: ApplyBaseStrategy
  localBranch: string | null
  localHeadOid: string
  isolatedHeadOid: string
  changedFiles: string[]
}

export interface WorktreeAcceptanceBlockerView {
  checkoutId: string
  ownerSessionId: string
  revision: number
  state: 'preview_active' | 'preview_detached' | 'finalized' | 'retained' | 'working' | 'ready_for_review' | 'delivered'
}

export type WorktreeApplyPreflightView =
  | ({ status: 'ready' | 'local_advanced' | 'already_in_local'; localModified: false } & WorktreeApplyPreflightFacts)
  | ({ status: 'conflict'; localModified: false; conflictingFiles: string[] } & WorktreeApplyPreflightFacts)
  | {
      status: 'blocked'
      localModified: false
      checkoutId: string
      reviewId: string | null
      revision: number
      reason: WorktreeApplyPreflightBlockedReason
      message: string
      /** Path-free identity for the exact Worktree holding this project's acceptance slot. */
      blocker?: WorktreeAcceptanceBlockerView
    }

export interface SessionTargetProjectView {
  id: string
  name: string
}

export interface SessionTargetCheckoutView {
  id: string
  kind: SessionCheckoutKind
  label: string
  phase: SessionCheckoutPhase
}

export interface SessionTargetSourceView {
  /** Source ref recorded when the target was created; detached sources use HEAD. */
  ref: string
  oid: string
}

export interface SessionTargetCurrentView {
  /** null explicitly means the checkout is on detached HEAD. */
  branch: string | null
  oid: string
}

export interface SessionTargetView {
  project: SessionTargetProjectView
  checkout: SessionTargetCheckoutView
  source: SessionTargetSourceView
  current: SessionTargetCurrentView
  ownership: 'owner' | 'inherited'
  dirty: boolean
  revision: number
  /** Delivery state for isolated checkouts; Local targets do not carry it. */
  delivery?: WorktreeDeliveryView
  /** Linear saved stages that remain unpublished to Local. */
  checkpoints?: WorktreeCheckpointView[]
  /** Host-derived CAS generation for the exact active Review/checkpoint state. */
  checkpointGeneration?: string
  /** Current project Local Preview slot state; does not expose another checkout identity. */
  reviewSlot?: 'available' | 'waiting'
  /** Owner Session holding the slot, used only for navigation/status. */
  reviewSlotOwnerSessionId?: string
}

export type SessionTargetBindChoice =
  | { kind: 'local' }
  | { kind: 'isolated' }

interface SessionCheckoutOperationBase {
  sessionId: string
  expectedRevision: number
}

export interface SessionCheckoutApplyOperation extends SessionCheckoutOperationBase {
  action: 'apply'
}

export interface SessionCheckoutFinishOperation extends SessionCheckoutOperationBase {
  action: 'finish'
  commitMessage: string
  retention?: WorktreeRetentionMode
  /** When present, Finish is bound to this persisted human-reviewed snapshot. */
  expectedReviewId?: string
}

export interface SessionCheckoutPreviewOperation extends SessionCheckoutOperationBase {
  action: 'preview'
}

export interface SessionCheckoutCheckpointOperation extends SessionCheckoutOperationBase {
  action: 'checkpoint'
  commitMessage: string
  expectedReviewId: string
  expectedGeneration: string
  requestId: string
}

export type WorktreePreviewRecoveryActionBlockReason =
  | 'stale_local'
  | 'preview_modified'
  | 'commit_isolation_conflict'
  | 'operation_not_allowed'
  | 'project_acceptance_busy'

export type WorktreePreviewRecoveryRollbackAction =
  | { status: 'safe'; targetTreeOid: string }
  | { status: 'blocked'; code: WorktreePreviewRecoveryActionBlockReason; message: string; conflictingFiles?: string[] }

export type WorktreePreviewRecoveryFinalizeAction =
  | {
      status: 'safe'
      taskTreeOid: string
      finalIndexTreeOid: string
      expectedWorkingTreeOid: string
      commitRequired: boolean
    }
  | { status: 'blocked'; code: WorktreePreviewRecoveryActionBlockReason; message: string; conflictingFiles?: string[] }

/** Host-issued read-only recovery context. Mutation always recomputes and compares it under the Host lock. */
export interface WorktreePreviewRecoveryProof {
  sessionId: string
  checkoutId: string
  reviewId: string
  previewId: string
  revision: number
  generation: string
  /** SHA-256 over the complete durable receipt; binds proof to retained recovery evidence. */
  receiptFingerprint: string
  localFingerprint: string
  localHeadOid: string
  localHeadRef: string | null
  localHeadTreeOid: string
  localIndexTreeOid: string
  localWorkingTreeOid: string
  rollback: WorktreePreviewRecoveryRollbackAction
  finalize: WorktreePreviewRecoveryFinalizeAction
  blocker?: WorktreeAcceptanceBlockerView
}

export type WorktreePreviewRecoveryPreflightBlockedReason =
  | 'not_owner'
  | 'not_preview_detached'
  | 'stale_target'
  | 'artifacts_missing'
  | 'checkout_unavailable'
  | 'git_error'

export type WorktreePreviewRecoveryPreflightView =
  | { status: 'assessed'; localModified: false; proof: WorktreePreviewRecoveryProof }
  | {
      status: 'blocked'
      localModified: false
      checkoutId: string
      reviewId: string | null
      previewId: string | null
      revision: number
      reason: WorktreePreviewRecoveryPreflightBlockedReason
      message: string
    }

export interface SessionCheckoutRollbackPreviewOperation extends SessionCheckoutOperationBase {
  action: 'rollback_preview'
  /** Structured withdraw-and-continue flow returns to working instead of preserving the review. */
  resumeRevision?: boolean
  /** Required only for preview_detached; it is context to re-verify, never bearer permission. */
  recoveryProof?: WorktreePreviewRecoveryProof
}

export interface SessionCheckoutFinalizePreviewOperation extends SessionCheckoutOperationBase {
  action: 'finalize_preview'
  commitMessage: string
  retention?: WorktreeRetentionMode
  /** Required only for preview_detached; it is context to re-verify, never bearer permission. */
  recoveryProof?: WorktreePreviewRecoveryProof
}

export interface SessionCheckoutRetryCleanupOperation extends SessionCheckoutOperationBase {
  action: 'retry_cleanup'
}

export interface SessionCheckoutDiscardOperation extends SessionCheckoutOperationBase {
  action: 'discard'
  confirmDirty: boolean
  rollbackPreview?: boolean
}

export interface SessionCheckoutRecoverOperation extends SessionCheckoutOperationBase {
  action: 'recover'
}

export type SessionCheckoutOperation =
  | SessionCheckoutApplyOperation
  | SessionCheckoutFinishOperation
  | SessionCheckoutPreviewOperation
  | SessionCheckoutCheckpointOperation
  | SessionCheckoutRollbackPreviewOperation
  | SessionCheckoutFinalizePreviewOperation
  | SessionCheckoutRetryCleanupOperation
  | SessionCheckoutDiscardOperation
  | SessionCheckoutRecoverOperation

export interface SessionCheckoutAppliedResult {
  status: 'applied'
  target: SessionTargetView
  changedFiles: string[]
}

export interface SessionCheckoutPreviewedResult {
  status: 'previewed'
  target: SessionTargetView
  changedFiles: string[]
}

export interface SessionCheckoutCheckpointedResult {
  status: 'checkpointed'
  target: SessionTargetView
  checkpoint: WorktreeCheckpointView
  changedFiles: string[]
}

export interface SessionCheckoutPreviewRolledBackResult {
  status: 'preview_rolled_back'
  target: SessionTargetView
  changedFiles: string[]
}

export interface SessionCheckoutPreviewDetachedResult {
  status: 'preview_detached'
  target: SessionTargetView
  changedFiles: string[]
  reason: 'stale_local' | 'preview_modified'
  attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'
}

export interface SessionCheckoutFinishedResult {
  status: 'finished'
  target: SessionTargetView
  changedFiles: string[]
  /** null means no task delta, so no empty commit was created. */
  commitOid: string | null
  /** retained means the commit succeeded and the user explicitly kept the frozen runtime. */
  cleanup: 'discarded' | 'pending' | 'retained'
  cleanupMessage?: string
  cleanupReason?: WorktreeCleanupReason
}

export type ManagedWorktreeCleanupEligibility = 'safe' | 'retained' | 'blocked'

export type ManagedWorktreeCleanupBlockReason =
  | 'working'
  | 'review_pending'
  | 'preview_active'
  | 'retention_active'
  | 'uncommitted_changes'
  | 'identity_mismatch'
  | 'cleanup_failed'
  | 'unknown'

/** Read-only inspection conclusion without paths. Bulk mutations re-validate; this result is never authorization. */
export interface ManagedWorktreeCleanupView {
  eligibility: ManagedWorktreeCleanupEligibility
  reason: ManagedWorktreeCleanupBlockReason
  message: string
  inspectedRevision: number
}

export interface BulkCleanupManagedWorktreeCandidate {
  checkoutId: string
  expectedRevision: number
}

export interface BulkCleanupManagedWorktreesResult {
  cleaned: Array<{ checkoutId: string; iteration: number; commitOid: string | null }>
  retained: Array<{ checkoutId: string; iteration: number; cleanup: ManagedWorktreeCleanupView }>
}

export type ManagedWorktreeSummaryState =
  | 'working'
  | 'ready_for_review'
  | 'preview_active'
  | 'retained'
  | 'cleanup_pending'
  | 'needs_attention'
  | 'delivered'

/** Path-free projection for the management surface. */
export interface ManagedWorktreeSummaryView {
  checkoutId: string
  revision: number
  ownerSessionId: string
  ownerSessionTitle: string
  project: SessionTargetProjectView
  iteration: number
  state: ManagedWorktreeSummaryState
  phase: SessionCheckoutPhase
  dirty: boolean
  commitOid: string | null
  /** Number of saved managed-Worktree stages not yet delivered to Local. */
  checkpointCount?: number
  retention?: Exclude<WorktreeRetentionMode, 'cleanup'>
  retainedAt?: number
  expiresAt?: number | null
  cleanupMessage?: string
  cleanupReason?: WorktreeCleanupReason
  approximateBytes: number | null
  updatedAt: number
  canCleanup: boolean
  /** Read-only cleanup inspection; real cleanup re-validates. */
  cleanup?: ManagedWorktreeCleanupView
  /** Active owner sessions the management surface stops before a forced discard. */
  activeSessionIds?: string[]
}

export type ApplyBaseStrategy =
  | 'recorded_base'
  | 'isolated_contains_local_head'
  | 'local_contains_isolated_head'

export interface SessionCheckoutConflictResult {
  status: 'conflict'
  code: 'apply_conflict'
  reason: 'content_conflict'
  target: SessionTargetView
  baseStrategy: ApplyBaseStrategy
  effectiveBaseOid: string
  /** Local HEAD at conflict time; the agent can sync the isolated checkout to this commit and resolve. */
  localHeadOid: string
  isolatedHeadOid: string
  canRetryAfterRefresh: false
  conflictingFiles: string[]
}

export interface SessionCheckoutDiscardedResult {
  status: 'discarded'
  target: SessionTargetView
}

export interface SessionCheckoutRecoveredResult {
  status: 'recovered'
  target: SessionTargetView
}

export interface SessionCheckoutOperationErrorResult {
  status: 'error'
  code: SessionCheckoutErrorCode
  message: string
  target?: SessionTargetView
}

export type SessionCheckoutOperationResult =
  | SessionCheckoutAppliedResult
  | SessionCheckoutPreviewedResult
  | SessionCheckoutCheckpointedResult
  | SessionCheckoutPreviewRolledBackResult
  | SessionCheckoutPreviewDetachedResult
  | SessionCheckoutFinishedResult
  | SessionCheckoutConflictResult
  | SessionCheckoutDiscardedResult
  | SessionCheckoutRecoveredResult
  | SessionCheckoutOperationErrorResult

export const SESSION_CHECKOUT_ERROR_CODES = [
  'session_not_found',
  'project_not_found',
  'project_root_missing',
  'not_git_repository',
  'target_unselected',
  'target_already_bound',
  'project_mismatch',
  'checkout_missing',
  'checkout_mismatch',
  'recovery_required',
  'registry_corrupt',
  'git_operation_failed',
  'not_owner',
  'stale_target',
  'dirty_confirmation_required',
  'apply_conflict',
  'apply_failed',
  'invalid_input',
  'invalid_plan',
  'stale_local',
  'stale_isolated',
  'git_error',
  'commit_isolation_conflict',
  'checkout_limit_reached',
  'project_acceptance_busy',
  'operation_not_allowed',
  'preview_not_active',
  'preview_modified',
  'recovery_unsafe',
] as const

export type SessionCheckoutErrorCode = typeof SESSION_CHECKOUT_ERROR_CODES[number]

export interface SessionCheckoutFailure {
  code: SessionCheckoutErrorCode
  message: string
}
