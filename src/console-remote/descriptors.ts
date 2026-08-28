import type { InvocationDescriptor, InvocationParameterDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import {
  booleanSchema,
  checkoutIdSchema,
  commitMessageSchema,
  createResponseSchema,
  currentResponseSchema,
  generationSchema,
  requestIdSchema,
  inspectResponseSchema,
  listResponseSchema,
  mutationResponseSchema,
  optionalBooleanSchema,
  outcomeSchema,
  preflightResponseSchema,
  previewRecoveryHandoffResponseSchema,
  previewRecoveryPreflightResponseSchema,
  previewRecoveryProofSchema,
  previewIdSchema,
  retainedModeSchema,
  recoveryContinuationSchema,
  retentionSchema,
  reviewDiffResponseSchema,
  reviewIdSchema,
  revisionSchema,
  sessionIdSchema,
  sidebarTopologyResponseSchema,
} from './schemas.js'

const PACKAGE = 'dsh-git-worktree'
const SERVICE = 'gitWorktree'
const AGENT_WIRE_TYPE = '@deepseek-ai/dsh-session/types#SessionId'

const agentParameter: InvocationParameterDescriptor = {
  name: 'agent',
  wire: 'agentId',
  source: 'lookup',
  lookup: 'agent',
  codec: { mode: 'strict', typeSymbol: AGENT_WIRE_TYPE, schema: sessionIdSchema },
}

function json(name: string, schema: { parse(value: unknown): unknown }, typeSymbol: string, acceptsUndefined = false): InvocationParameterDescriptor {
  return {
    name,
    wire: name,
    source: 'json',
    ...(acceptsUndefined ? { acceptsUndefined: true as const } : {}),
    codec: { mode: 'strict', typeSymbol, schema },
  }
}

function descriptor(
  method: string,
  parameters: readonly InvocationParameterDescriptor[],
  resultSchema: { parse(value: unknown): unknown },
  resultType: string,
  withAgent = true,
): InvocationDescriptor {
  return {
    id: `${PACKAGE}#${SERVICE}/${method}`,
    service: SERVICE,
    namespace: SERVICE,
    method,
    invocation: { kind: 'direct' },
    parameters: withAgent ? [agentParameter, ...parameters] : parameters,
    result: { mode: 'strict', typeSymbol: `${PACKAGE}/console-contract#${resultType}`, schema: resultSchema },
  }
}

export const WORKTREE_CONSOLE_DESCRIPTORS: readonly InvocationDescriptor[] = Object.freeze([
  descriptor('sidebarTopology', [], outcomeSchema(sidebarTopologyResponseSchema), 'WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>', false),
  descriptor('current', [], outcomeSchema(currentResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>'),
  descriptor('list', [
    json('needsAttention', optionalBooleanSchema, 'boolean | undefined', true),
    json('includeDelivered', optionalBooleanSchema, 'boolean | undefined', true),
  ], outcomeSchema(listResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleListResponse>'),
  descriptor('create', [], outcomeSchema(createResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>'),
  descriptor('inspect', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleInspectRequest.checkoutId`),
  ], outcomeSchema(inspectResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>'),
  descriptor('reviewDiff', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleReviewDiffRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleReviewDiffRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleReviewDiffRequest.expectedReviewId`),
  ], outcomeSchema(reviewDiffResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>'),
  descriptor('preflight', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreflightRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreflightRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreflightRequest.expectedReviewId`),
  ], outcomeSchema(preflightResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>'),
  descriptor('previewRecoveryPreflight', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.expectedReviewId`),
    json('expectedPreviewId', previewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.expectedPreviewId`),
  ], outcomeSchema(previewRecoveryPreflightResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>'),
  descriptor('preparePreviewRecoveryAnalysis', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.expectedReviewId`),
    json('expectedPreviewId', previewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.expectedPreviewId`),
    json('recoveryProof', previewRecoveryProofSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.recoveryProof`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('createPreviewRecoveryHandoff', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.expectedReviewId`),
    json('expectedPreviewId', previewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.expectedPreviewId`),
    json('recoveryProof', previewRecoveryProofSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.recoveryProof`),
  ], outcomeSchema(previewRecoveryHandoffResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>'),
  descriptor('preview', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRequest.expectedReviewId`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('checkpoint', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.expectedReviewId`),
    json('expectedGeneration', generationSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.expectedGeneration`),
    json('requestId', requestIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.requestId`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.commitMessage`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('resumeRevision', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.expectedReviewId`),
    json('conflictContinuation', recoveryContinuationSchema.optional(), `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.conflictContinuation`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('prepareReviewRegeneration', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePrepareRegenerationRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePrepareRegenerationRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePrepareRegenerationRequest.expectedReviewId`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('rollbackPreview', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.expectedRevision`),
    json('resumeRevision', optionalBooleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.resumeRevision`, true),
    json('recoveryProof', previewRecoveryProofSchema.optional(), `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.recoveryProof`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('discard', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.expectedRevision`),
    json('confirmDirty', booleanSchema, 'boolean'),
    json('rollbackPreview', optionalBooleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.rollbackPreview`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('finalize', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.expectedReviewId`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.commitMessage`),
    json('retention', retentionSchema, `${PACKAGE}/types#WorktreeRetentionMode`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('finalizePreview', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.expectedReviewId`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.commitMessage`),
    json('retention', retentionSchema, `${PACKAGE}/types#WorktreeRetentionMode`),
    json('recoveryProof', previewRecoveryProofSchema.optional(), `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.recoveryProof`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('setRetention', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetRetentionRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetRetentionRequest.expectedRevision`),
    json('retention', retainedModeSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetRetentionRequest.retention`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('retryCleanup', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleRetryCleanupRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleRetryCleanupRequest.expectedRevision`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('beginNextIteration', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleBeginNextIterationRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleBeginNextIterationRequest.expectedRevision`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
])

export const WORKTREE_CONSOLE_REMOTE: TypertRemoteContribution = Object.freeze({
  package: PACKAGE,
  descriptors: WORKTREE_CONSOLE_DESCRIPTORS,
})
