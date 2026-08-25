import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleAdapter,
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
} from '../../console-contract.js'
import type { GitWorktreeRemote } from '../../console-remote/remote.js'
import { WORKTREE_CONSOLE_DESCRIPTORS } from '../../console-remote/descriptors.js'

function transport<T>(message: string): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code: 'transport_unavailable', message } }
}

function malformed<T>(method: string): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code: 'malformed_response', message: `Remote ${method} 返回了不符合 strict contract 的 payload` } }
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'message' in value) return String(value.message)
  return String(value)
}

function isCodecRejection(value: unknown): boolean {
  const message = messageOf(value)
  return message.includes('rejected "') || message.includes('返回了不符合 strict contract')
}

export function createWorktreeConsoleRemoteAdapter(remote: GitWorktreeRemote): WorktreeConsoleAdapter {
  const descriptors = new Map(WORKTREE_CONSOLE_DESCRIPTORS.map(descriptor => [descriptor.method, descriptor]))

  async function invoke<T>(method: string, call: () => Promise<RemoteResult<WorktreeConsoleOutcome<T>>>): Promise<WorktreeConsoleOutcome<T>> {
    let carrier: RemoteResult<WorktreeConsoleOutcome<T>>
    try {
      carrier = await call()
    } catch (error) {
      return isCodecRejection(error) ? malformed(method) : transport(messageOf(error))
    }
    if (typeof carrier !== 'object' || carrier === null || typeof carrier.ok !== 'boolean') return malformed(method)
    if (!carrier.ok) return isCodecRejection(carrier.error) ? malformed(method) : transport(carrier.error.message)
    const descriptor = descriptors.get(method)
    if (descriptor?.result.mode !== 'strict') return malformed(method)
    try {
      return descriptor.result.schema.parse(carrier.value) as WorktreeConsoleOutcome<T>
    } catch {
      return malformed(method)
    }
  }

  return {
    current: request => invoke<WorktreeConsoleCurrentResponse>('current', () => remote.current(request.sessionId)),
    list: request => invoke<WorktreeConsoleListResponse>('list', () => remote.list(request.sessionId, request.needsAttention, request.includeDelivered)),
    create: request => invoke<WorktreeConsoleCreateResponse>('create', () => remote.create(request.sourceSessionId)),
    inspect: request => invoke<WorktreeConsoleInspectResponse>('inspect', () => remote.inspect(request.sessionId, request.checkoutId)),
    reviewDiff: request => invoke<WorktreeConsoleReviewDiffResponse>('reviewDiff', () => remote.reviewDiff(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId)),
    preflight: request => invoke<WorktreeConsolePreflightResponse>('preflight', () => remote.preflight(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId)),
    previewRecoveryPreflight: request => invoke<WorktreeConsolePreviewRecoveryPreflightResponse>('previewRecoveryPreflight', () => remote.previewRecoveryPreflight(
      request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedPreviewId,
    )),
    preparePreviewRecoveryAnalysis: request => invoke<WorktreeConsoleMutationResponse>('preparePreviewRecoveryAnalysis', () => remote.preparePreviewRecoveryAnalysis(
      request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedPreviewId, request.recoveryProof,
    )),
    createPreviewRecoveryHandoff: request => invoke<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>('createPreviewRecoveryHandoff', () => remote.createPreviewRecoveryHandoff(
      request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedPreviewId, request.recoveryProof,
    )),
    preview: request => invoke<WorktreeConsoleMutationResponse>('preview', () => remote.preview(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId)),
    checkpoint: request => invoke<WorktreeConsoleMutationResponse>('checkpoint', () => remote.checkpoint(
      request.sessionId,
      request.checkoutId,
      request.expectedRevision,
      request.expectedReviewId,
      request.expectedGeneration,
      request.requestId,
      request.commitMessage,
    )),
    resumeRevision: request => invoke<WorktreeConsoleMutationResponse>('resumeRevision', () => request.conflictContinuation
      ? remote.resumeRevision(
          request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.conflictContinuation,
        )
      : remote.resumeRevision(
          request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId,
        )),
    prepareReviewRegeneration: request => invoke<WorktreeConsoleMutationResponse>('prepareReviewRegeneration', () => remote.prepareReviewRegeneration(
      request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId,
    )),
    rollbackPreview: request => invoke<WorktreeConsoleMutationResponse>('rollbackPreview', () => remote.rollbackPreview(
      request.sessionId, request.checkoutId, request.expectedRevision, request.resumeRevision, request.recoveryProof,
    )),
    discard: request => invoke<WorktreeConsoleMutationResponse>('discard', () => remote.discard(request.sessionId, request.checkoutId, request.expectedRevision, request.confirmDirty, request.rollbackPreview)),
    finalize: request => invoke<WorktreeConsoleMutationResponse>('finalize', () => remote.finalize(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.commitMessage, request.retention)),
    finalizePreview: request => invoke<WorktreeConsoleMutationResponse>('finalizePreview', () => remote.finalizePreview(
      request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.commitMessage, request.retention, request.recoveryProof,
    )),
    setRetention: request => invoke<WorktreeConsoleMutationResponse>('setRetention', () => remote.setRetention(request.sessionId, request.checkoutId, request.expectedRevision, request.retention)),
    retryCleanup: request => invoke<WorktreeConsoleMutationResponse>('retryCleanup', () => remote.retryCleanup(request.sessionId, request.checkoutId, request.expectedRevision)),
    beginNextIteration: request => invoke<WorktreeConsoleMutationResponse>('beginNextIteration', () => remote.beginNextIteration(request.sessionId, request.checkoutId, request.expectedRevision)),
  }
}
