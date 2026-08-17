import { z } from 'zod'
import {
  WORKTREE_CONSOLE_ERROR_CODES,
  WORKTREE_CONSOLE_TARGET_STATES,
  type WorktreeConsoleCreateResponse,
  type WorktreeConsoleCurrentResponse,
  type WorktreeConsoleInspectResponse,
  type WorktreeConsoleListResponse,
  type WorktreeConsoleMutationResponse,
  type WorktreeConsoleOutcome,
  type WorktreeConsolePreflightResponse,
  type WorktreeConsoleReviewDiffResponse,
} from '../console-contract.js'

const strict = <T extends z.core.$ZodLooseShape>(shape: T) => z.object(shape).strict()

export const sessionIdSchema = z.string().min(1)
export const checkoutIdSchema = z.string().min(1).refine(value => !value.includes('..') && !/[\\/\0]/u.test(value), 'unsafe checkout id')
export const reviewIdSchema = z.string().min(1)
export const commitMessageSchema = z.string().trim().min(1).max(500)
export const revisionSchema = z.number().int().nonnegative()
export const oidSchema = z.union([
  z.literal('unversioned'),
  z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu),
])
export const booleanSchema = z.boolean()
export const optionalBooleanSchema = z.union([booleanSchema, z.undefined()])
export const retentionSchema = z.enum(['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'])
export const retainedModeSchema = z.enum(['retain_24h', 'retain_3d', 'retain_manual'])

const projectSchema = strict({ id: z.string().min(1), name: z.string().min(1) })
const validationItemSchema = strict({
  command: z.string(),
  status: z.enum(['passed', 'failed', 'not_run']),
  summary: z.string().optional(),
})
const reviewSchema = strict({
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  iteration: z.number().int().nonnegative(),
  preparedAt: z.number().finite(),
  summary: z.string(),
  validationStatus: z.enum(['passed', 'failed', 'partial', 'not_run']),
  validationSummary: z.string().optional(),
  tests: z.array(validationItemSchema),
  changedFiles: z.array(z.string()),
  suggestedCommitMessage: z.string().min(1),
})
const capabilitiesSchema = strict({
  create: z.boolean(),
  open: z.boolean(),
  inspect: z.boolean(),
  discard: z.boolean(),
  preflight: z.boolean(),
  preview: z.boolean(),
  rollbackPreview: z.boolean(),
  finalize: z.boolean(),
  finalizePreview: z.boolean(),
  setRetention: z.boolean(),
  retryCleanup: z.boolean(),
  beginNextIteration: z.boolean(),
})
const targetSummarySchema = strict({
  project: projectSchema,
  checkoutId: checkoutIdSchema.nullable(),
  sourceSessionId: sessionIdSchema,
  ownerSessionId: sessionIdSchema,
  targetSessionId: sessionIdSchema.nullable(),
  iteration: z.number().int().nonnegative(),
  revision: revisionSchema,
  state: z.enum(WORKTREE_CONSOLE_TARGET_STATES),
  phase: z.enum(['local', 'preparing', 'ready', 'applying', 'mutating', 'recovery_required', 'finalized', 'retained', 'discarded']),
  dirty: z.boolean(),
  currentOid: oidSchema,
  commitOid: oidSchema.nullable(),
  retention: retainedModeSchema.optional(),
  retainedAt: z.number().finite().optional(),
  expiresAt: z.number().finite().nullable().optional(),
  cleanupMessage: z.string().optional(),
  review: reviewSchema.optional(),
  reviewSlot: z.enum(['available', 'waiting']).optional(),
  reviewSlotOwnerSessionId: sessionIdSchema.optional(),
  previewRecovery: strict({
    reason: z.enum(['stale_local', 'preview_modified']),
    attemptedAction: z.enum(['rollback_preview', 'finalize_preview', 'discard']),
  }).optional(),
  capabilities: capabilitiesSchema,
})
const targetDetailsSchema = targetSummarySchema.extend({
  managedRoot: z.string().min(1).nullable(),
  sourceOid: oidSchema,
  currentBranch: z.string().nullable(),
}).strict()

const consoleErrorSchema = strict({
  code: z.enum(WORKTREE_CONSOLE_ERROR_CODES),
  message: z.string(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export function outcomeSchema<T>(value: z.ZodType<T>): z.ZodType<WorktreeConsoleOutcome<T>> {
  return z.discriminatedUnion('ok', [
    strict({ ok: z.literal(true), value }),
    strict({ ok: z.literal(false), error: consoleErrorSchema }),
  ]) as z.ZodType<WorktreeConsoleOutcome<T>>
}

export const currentResponseSchema: z.ZodType<WorktreeConsoleCurrentResponse> = strict({ target: targetDetailsSchema })
export const createResponseSchema: z.ZodType<WorktreeConsoleCreateResponse> = strict({
  target: targetDetailsSchema,
  targetSessionId: sessionIdSchema,
  managedRoot: z.string().min(1),
})
export const inspectResponseSchema: z.ZodType<WorktreeConsoleInspectResponse> = strict({ target: targetDetailsSchema })
export const listResponseSchema: z.ZodType<WorktreeConsoleListResponse> = strict({ project: projectSchema, worktrees: z.array(targetSummarySchema) })
export const mutationResponseSchema: z.ZodType<WorktreeConsoleMutationResponse> = strict({
  target: targetSummarySchema,
  changedFiles: z.array(z.string()).optional(),
  commitOid: oidSchema.nullable().optional(),
})
const diffFileSchema = strict({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']),
  patch: z.string().nullable(),
  truncated: z.boolean(),
})
const preflightFactsSchema = {
  localModified: z.literal(false),
  checkoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  configuredBaseOid: oidSchema,
  effectiveBaseOid: oidSchema,
  baseStrategy: z.enum(['recorded_base', 'isolated_contains_local_head', 'local_contains_isolated_head']),
  localBranch: z.string().nullable(),
  localHeadOid: oidSchema,
  isolatedHeadOid: oidSchema,
  changedFiles: z.array(z.string()),
}
const preflightSchema = z.union([
  strict({ status: z.enum(['ready', 'local_advanced', 'already_in_local']), ...preflightFactsSchema }),
  strict({ status: z.literal('conflict'), ...preflightFactsSchema, conflictingFiles: z.array(z.string()) }),
  strict({
    status: z.literal('blocked'),
    localModified: z.literal(false),
    checkoutId: z.string(),
    reviewId: reviewIdSchema.nullable(),
    revision: revisionSchema,
    reason: z.enum(['not_owner', 'not_ready_for_review', 'stale_target', 'stale_isolated', 'project_acceptance_busy', 'checkout_unavailable', 'git_error']),
    message: z.string(),
  }),
])
export const preflightResponseSchema: z.ZodType<WorktreeConsolePreflightResponse> = strict({ preflight: preflightSchema })

export const reviewDiffResponseSchema: z.ZodType<WorktreeConsoleReviewDiffResponse> = strict({
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  files: z.array(diffFileSchema).max(200),
  truncated: z.boolean(),
})
