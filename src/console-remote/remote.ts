import type { RemoteResult, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsoleReviewDiffResponse,
  WorktreeApplyConflictContinuation,
} from '../console-contract.js'
import type { WorktreePreviewRecoveryProof, WorktreeRetentionMode } from '../types.js'
import { WORKTREE_CONSOLE_REMOTE } from './descriptors.js'

export type GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>

export default WORKTREE_CONSOLE_REMOTE
export { WORKTREE_CONSOLE_DESCRIPTORS, WORKTREE_CONSOLE_REMOTE } from './descriptors.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'gitWorktree/current': (agentId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>>>
    'gitWorktree/list': (agentId: string, needsAttention?: boolean, includeDelivered?: boolean) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleListResponse>>>
    'gitWorktree/create': (agentId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>>>
    'gitWorktree/inspect': (agentId: string, checkoutId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>>>
    'gitWorktree/reviewDiff': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>>>
    'gitWorktree/preflight': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>>>
    'gitWorktree/previewRecoveryPreflight': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedPreviewId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>>>
    'gitWorktree/preparePreviewRecoveryAnalysis': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedPreviewId: string, recoveryProof: WorktreePreviewRecoveryProof) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/createPreviewRecoveryHandoff': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedPreviewId: string, recoveryProof: WorktreePreviewRecoveryProof) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>>>
    'gitWorktree/preview': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/checkpoint': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedGeneration: string, requestId: string, commitMessage: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/resumeRevision': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, conflictContinuation?: WorktreeApplyConflictContinuation) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/prepareReviewRegeneration': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/rollbackPreview': (agentId: string, checkoutId: string, expectedRevision: number, resumeRevision?: boolean, recoveryProof?: WorktreePreviewRecoveryProof) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/discard': (agentId: string, checkoutId: string, expectedRevision: number, confirmDirty: boolean, rollbackPreview?: boolean) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/finalize': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, commitMessage: string, retention: WorktreeRetentionMode) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/finalizePreview': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, commitMessage: string, retention: WorktreeRetentionMode, recoveryProof?: WorktreePreviewRecoveryProof) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/setRetention': (agentId: string, checkoutId: string, expectedRevision: number, retention: Exclude<WorktreeRetentionMode, 'cleanup'>) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/retryCleanup': (agentId: string, checkoutId: string, expectedRevision: number) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/beginNextIteration': (agentId: string, checkoutId: string, expectedRevision: number) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
  }

  interface TypertRemoteNamespaceMap {
    gitWorktree: TypertRemoteNamespace<'gitWorktree'>
  }
}
