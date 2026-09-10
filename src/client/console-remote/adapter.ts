import { createTranslator, normalizeLanguage, type Language } from '../../i18n/core.js'
import { transportMessages } from '../../i18n/transport-messages.js'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCreatePreflightResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsoleReviewDiffResponse,
  WorktreeSidebarTopologyResponse,
} from '../../console-contract.js'
import type { GitWorktreeRemote } from '../../console-remote/remote.js'
import { WORKTREE_CONSOLE_DESCRIPTORS } from '../../console-remote/descriptors.js'

function transport<T>(message: string): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code: 'transport_unavailable', message } }
}

function malformed<T>(method: string, locale: Language): WorktreeConsoleOutcome<T> {
  return { ok: false, error: { code: 'malformed_response', message: createTranslator(transportMessages, locale)('malformed', { method }) } }
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

export function createWorktreeConsoleRemoteAdapter(remote: GitWorktreeRemote, getLanguage: () => Language = () => 'zh'): WorktreeConsoleAdapter {
  const descriptors = new Map(WORKTREE_CONSOLE_DESCRIPTORS.map(descriptor => [descriptor.method, descriptor]))

  async function invoke<T>(method: string, call: (locale: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<T>>>): Promise<WorktreeConsoleOutcome<T>> {
    const locale = normalizeLanguage(getLanguage())
    let carrier: RemoteResult<WorktreeConsoleOutcome<T>>
    try {
      carrier = await call(locale)
    } catch (error) {
      return isCodecRejection(error) ? malformed(method, locale) : transport(messageOf(error))
    }
    if (typeof carrier !== 'object' || carrier === null || typeof carrier.ok !== 'boolean') return malformed(method, locale)
    if (!carrier.ok) return isCodecRejection(carrier.error) ? malformed(method, locale) : transport(carrier.error.message)
    const descriptor = descriptors.get(method)
    if (descriptor?.result.mode !== 'strict') return malformed(method, locale)
    try {
      return descriptor.result.schema.parse(carrier.value) as WorktreeConsoleOutcome<T>
    } catch {
      return malformed(method, locale)
    }
  }

  return {
    sidebarTopology: () => invoke<WorktreeSidebarTopologyResponse>('sidebarTopology', locale => remote.sidebarTopology(locale)),
    current: request => invoke<WorktreeConsoleCurrentResponse>('current', locale => remote.current(request.sessionId, locale)),
    list: request => invoke<WorktreeConsoleListResponse>('list', locale => remote.list(request.sessionId, request.needsAttention, request.includeDelivered, locale)),
    preflightCreate: request => invoke<WorktreeConsoleCreatePreflightResponse>('preflightCreate', locale => remote.preflightCreate(request.sourceSessionId, locale)),
    createWithInitialCommit: request => invoke<WorktreeConsoleCreateResponse>('createWithInitialCommit', locale => remote.createWithInitialCommit(request.sourceSessionId, request.confirmationToken, locale)),
    create: request => invoke<WorktreeConsoleCreateResponse>('create', locale => remote.create(request.sourceSessionId, locale)),
    inspect: request => invoke<WorktreeConsoleInspectResponse>('inspect', locale => remote.inspect(request.sessionId, request.checkoutId, locale)),
    reviewDiff: request => invoke<WorktreeConsoleReviewDiffResponse>('reviewDiff', locale => remote.reviewDiff(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, locale)),
    preflight: request => invoke<WorktreeConsolePreflightResponse>('preflight', locale => remote.preflight(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, locale)),
    previewRecoveryPreflight: request => invoke<WorktreeConsolePreviewRecoveryPreflightResponse>('previewRecoveryPreflight', locale => remote.previewRecoveryPreflight(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedPreviewId, locale)),
    preparePreviewRecoveryAnalysis: request => invoke<WorktreeConsoleMutationResponse>('preparePreviewRecoveryAnalysis', locale => remote.preparePreviewRecoveryAnalysis(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedPreviewId, request.recoveryProof, locale)),
    createPreviewRecoveryHandoff: request => invoke<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>('createPreviewRecoveryHandoff', locale => remote.createPreviewRecoveryHandoff(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedPreviewId, request.recoveryProof, locale)),
    preview: request => invoke<WorktreeConsoleMutationResponse>('preview', locale => remote.preview(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, locale)),
    checkpoint: request => invoke<WorktreeConsoleMutationResponse>('checkpoint', locale => remote.checkpoint(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.expectedGeneration, request.requestId, request.commitMessage, locale)),
    resumeRevision: request => invoke<WorktreeConsoleMutationResponse>('resumeRevision', locale => request.conflictContinuation
      ? remote.resumeRevision(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.conflictContinuation, locale)
      : remote.resumeRevision(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, undefined, locale)),
    prepareReviewRegeneration: request => invoke<WorktreeConsoleMutationResponse>('prepareReviewRegeneration', locale => remote.prepareReviewRegeneration(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, locale)),
    rollbackPreview: request => invoke<WorktreeConsoleMutationResponse>('rollbackPreview', locale => remote.rollbackPreview(request.sessionId, request.checkoutId, request.expectedRevision, request.resumeRevision, request.recoveryProof, locale)),
    discard: request => invoke<WorktreeConsoleMutationResponse>('discard', locale => remote.discard(request.sessionId, request.checkoutId, request.expectedRevision, request.confirmDirty, request.rollbackPreview, locale)),
    finalize: request => invoke<WorktreeConsoleMutationResponse>('finalize', locale => remote.finalize(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.commitMessage, request.retention, locale)),
    finalizePreview: request => invoke<WorktreeConsoleMutationResponse>('finalizePreview', locale => remote.finalizePreview(request.sessionId, request.checkoutId, request.expectedRevision, request.expectedReviewId, request.commitMessage, request.retention, request.recoveryProof, locale)),
    setRetention: request => invoke<WorktreeConsoleMutationResponse>('setRetention', locale => remote.setRetention(request.sessionId, request.checkoutId, request.expectedRevision, request.retention, locale)),
    retryCleanup: request => invoke<WorktreeConsoleMutationResponse>('retryCleanup', locale => remote.retryCleanup(request.sessionId, request.checkoutId, request.expectedRevision, locale)),
    beginNextIteration: request => invoke<WorktreeConsoleMutationResponse>('beginNextIteration', locale => remote.beginNextIteration(request.sessionId, request.checkoutId, request.expectedRevision, locale)),
  }
}
