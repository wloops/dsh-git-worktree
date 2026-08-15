import type { RemoteResult, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsoleReviewDiffResponse,
} from '../console-contract.js'
import type { WorktreeRetentionMode } from '../types.js'
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
    'gitWorktree/discard': (agentId: string, checkoutId: string, expectedRevision: number, confirmDirty: boolean) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/finalize': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, retention: WorktreeRetentionMode) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/setRetention': (agentId: string, checkoutId: string, expectedRevision: number, retention: Exclude<WorktreeRetentionMode, 'cleanup'>) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/retryCleanup': (agentId: string, checkoutId: string, expectedRevision: number) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
  }

  interface TypertRemoteNamespaceMap {
    gitWorktree: TypertRemoteNamespace<'gitWorktree'>
  }
}
