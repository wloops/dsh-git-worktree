/**
 * Port interfaces for the session-checkout domain, ported from Domi's
 * `session-checkout/ports.ts`. The domain logic depends only on these ports;
 * the DSH adapters (subprocess-backed git, plugin-owned registry storage,
 * session/workspace lookup) live behind them so the state machine and apply
 * engine stay host-agnostic and testable with fakes.
 * @module dsh-git-worktree/ports
 */

import type {
  ApplyBaseStrategy,
  SessionCheckoutPhase,
  SessionTargetRef,
  WorktreeValidationItem,
  WorktreeRetentionMode,
  WorktreeValidationStatus,
} from './types.js'
import type { SessionCheckoutApplyEngine } from './session-checkout-apply.js'

export interface SessionCheckoutSessionRecord {
  id: string
  projectId?: string
  /** Only used for readable managed worktree directory names; never identity. */
  title?: string
}

export interface SessionCheckoutProjectRecord {
  id: string
  name: string
  root: string
}

export interface SessionCheckoutLookupPort {
  getSession(sessionId: string): SessionCheckoutSessionRecord | undefined
  getProject(projectId: string): SessionCheckoutProjectRecord | undefined
}

export interface GitCheckoutSnapshot {
  root: string
  commonDir: string
  gitDir: string
  branch: string | null
  headOid: string
  headRef: string
}

export interface SessionCheckoutGitPort {
  inspect(root: string): Promise<GitCheckoutSnapshot | null>
  /** Top-level of the Git checkout containing the directory; does not require a HEAD. */
  findContainingWorktreeRoot(root: string): Promise<string | null>
  status(root: string): Promise<{ dirty: boolean }>
  createDetachedWorktree(localRoot: string, managedRoot: string, baseOid: string): Promise<void>
  /** Deletion after the host verified checkout identity and the full fingerprint including untracked. */
  removeWorktree(localRoot: string, managedRoot: string): Promise<void>
  retainApplyBase(localRoot: string, checkoutId: string, oid: string): Promise<void>
  releaseApplyBase(localRoot: string, checkoutId: string): Promise<void>
  retainInternalArtifact(localRoot: string, checkoutId: string, artifactName: string, oid: string): Promise<void>
  releaseInternalArtifacts(localRoot: string, checkoutId: string, artifactPrefix?: string): Promise<void>
  /** Read-only ancestry proof; only accepts host-verified checkout roots and OIDs. */
  isAncestor(root: string, ancestorOid: string, descendantOid: string): Promise<boolean>
}

export interface DirectoryIdentity {
  device: string
  inode: string
  birthtimeNs: string
}

export interface SessionCheckoutFilesPort {
  exists(path: string): boolean
  canonicalize(path: string): Promise<string>
  inspectDirectoryIdentity(path: string): Promise<DirectoryIdentity | null>
  ensureDirectory(path: string): void
  /** Deletes only when the whole tree contains no files or symlinks; used to collect empty `git worktree add` residue. */
  removeEmptyDirectoryTree(path: string): boolean
  /** Atomically moves residue whose file identity matches into the plugin quarantine. */
  quarantineDirectoryTree(path: string, expectedIdentity: DirectoryIdentity, quarantinePath: string): Promise<void>
  /** Deletes a fully owned non-empty directory tree; the root must not be a file or symlink. */
  removeDirectoryTree(path: string): Promise<void>
  /** Estimates real file usage; does not follow symlinks. */
  measureDirectoryBytes(path: string): Promise<number>
}

export interface SessionBindingRecord {
  sessionId: string
  projectId: string
  projectName: string
  target: SessionTargetRef
  ownerSessionId: string
  inheritedFromSessionId?: string
  sourceRef: string
  sourceOid: string
  revision: number
}

interface ManagedCheckoutJournalBase {
  operationId: string
  startedAt: number
}

export interface ManagedCheckoutCreateJournal extends ManagedCheckoutJournalBase {
  operation: 'create'
  step: 'creating_worktree'
}

export interface ManagedCheckoutMutationJournal extends ManagedCheckoutJournalBase {
  operation: 'apply' | 'preview' | 'rollback_preview' | 'finish' | 'finalize_preview' | 'cleanup'
  step: 'planning' | 'artifacts_retained' | 'writing_local' | 'updating_ref' | 'replacing_index' | 'removing_worktree'
  baseOid?: string
  planRevision?: string
  previewId?: string
  reviewId?: string
  localFingerprint?: string
  isolatedFingerprint?: string
  effectiveBaseOid?: string
  baseStrategy?: ApplyBaseStrategy
  localHeadOid?: string
  isolatedHeadOid?: string
  commitOid?: string
  retention?: WorktreeRetentionMode
  /** rollback_preview crash recovery must preserve whether the review returns to working or ready_for_review. */
  resumeRevision?: boolean
  changedFiles?: string[]
  managedDirectoryIdentity?: DirectoryIdentity
  cleanupQuarantinePath?: string
}

export type ManagedCheckoutJournal = ManagedCheckoutCreateJournal | ManagedCheckoutMutationJournal

export interface ManagedWorktreeReviewRecord {
  reviewId: string
  iteration: number
  preparedAt: number
  detailsMarkdown?: string
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  changedFiles: string[]
  suggestedCommitMessage: string
  isolatedFingerprint: string
  isolatedHeadOid: string
}

export interface ManagedPreviewReceipt {
  previewId: string
  reviewId: string
  iteration: number
  previewedAt: number
  configuredBaseOid: string
  effectiveBaseOid: string
  baseStrategy: ApplyBaseStrategy
  localHeadOid: string
  localHeadRef: string | null
  localFingerprintBefore: string
  localFingerprintPreview: string
  localWorkingTreeOid: string
  localIndexTreeOid: string
  previewWorkingTreeOid: string
  isolatedHeadOid: string
  isolatedFingerprint: string
  isolatedSnapshotOid: string
  changedFiles: string[]
}

export interface ManagedDeliveryProof {
  localBranch: string | null
  localHeadBefore: string
  localHeadAfter: string
  changedFiles: string[]
  /** Optional for backward compatibility with historical version-2 registries. */
  validationStatus?: WorktreeValidationStatus
  validationSummary?: string
}

export interface ManagedApplyConflictRecoveryContinuation {
  kind: 'worktree_apply_conflict'
  requestId: string
  reviewId: string
  readyRevision: number
  workingRevision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface ManagedReviewRegenerationContinuation {
  kind: 'worktree_review_regeneration'
  requestId: string
  reviewId: string
  revision: number
}

export type ManagedRecoveryContinuation =
  | ManagedApplyConflictRecoveryContinuation
  | ManagedReviewRegenerationContinuation

export type ManagedCheckoutDelivery =
  | { state: 'working'; iteration: number }
  | { state: 'ready_for_review'; review: ManagedWorktreeReviewRecord }
  | { state: 'preview_active'; review: ManagedWorktreeReviewRecord; preview: ManagedPreviewReceipt }
  | {
      state: 'preview_detached'
      review: ManagedWorktreeReviewRecord
      preview: ManagedPreviewReceipt
      detachedAt: number
      reason: 'stale_local' | 'preview_modified'
      attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'
    }
  | {
      state: 'finalized'
      review: ManagedWorktreeReviewRecord
      commitOid: string | null
      /** Newer delivery proof; historical registries may omit it. */
      proof?: ManagedDeliveryProof
      /** The delivered isolated snapshot; cleanup retry must do fingerprint CAS. */
      isolatedFingerprint: string
      finalizedAt: number
      cleanup: 'pending' | 'blocked'
      cleanupMessage?: string
    }
  | {
      state: 'retained'
      review: ManagedWorktreeReviewRecord
      commitOid: string | null
      proof?: ManagedDeliveryProof
      isolatedFingerprint: string
      retention: Exclude<WorktreeRetentionMode, 'cleanup'>
      retainedAt: number
      expiresAt: number | null
      cleanup: 'scheduled' | 'blocked'
      cleanupMessage?: string
    }
  | { state: 'delivered'; iteration: number; commitOid: string | null; proof?: ManagedDeliveryProof; deliveredAt: number }

export interface ManagedCheckoutRecord {
  checkoutId: string
  /** Prior delivered checkout whose immutable Harness cwd path this iteration safely reuses. */
  predecessorCheckoutId?: string
  projectId: string
  projectName: string
  ownerSessionId: string
  /** Local session that created this target; historical records may omit it. */
  sourceSessionId?: string
  /** Canonical root of the project in the user's Local Checkout. */
  localRoot: string
  /** Canonical root of the project in the managed worktree; also the lease cwd. */
  managedRoot: string
  /** Repo top level of the managed Git worktree; the project root may be a subdirectory. */
  managedGitRoot: string
  gitCommonDir: string
  gitDir: string
  baseOid: string
  /** Last successfully applied isolated snapshot; does not change the user-visible Session Base. */
  applyBaseOid?: string
  /** Host-authoritative one-shot context for an explicitly resumed apply conflict. */
  recoveryContinuation?: ManagedRecoveryContinuation
  sourceRef: string
  phase: SessionCheckoutPhase
  delivery: ManagedCheckoutDelivery
  journal: ManagedCheckoutJournal | null
  revision: number
}

export interface ManagedCheckoutsRegistry {
  version: 2
  revision: number
  sessionBindings: Record<string, SessionBindingRecord>
  managedCheckouts: Record<string, ManagedCheckoutRecord>
}

export interface SessionCheckoutRegistryPort {
  read(): ManagedCheckoutsRegistry
  write(registry: ManagedCheckoutsRegistry): void
}

export interface SessionCheckoutDependencies {
  lookup: SessionCheckoutLookupPort
  git: SessionCheckoutGitPort
  files: SessionCheckoutFilesPort
  registry: SessionCheckoutRegistryPort
  applyEngine: SessionCheckoutApplyEngine
  managedCheckoutsRoot: string
  createCheckoutId(): string
}
