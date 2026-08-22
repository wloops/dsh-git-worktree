import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleBeginNextIterationRequest,
  WorktreeConsoleCreateRequest,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCurrentRequest,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleDiscardRequest,
  WorktreeConsoleFinalizePreviewRequest,
  WorktreeConsoleFinalizeRequest,
  WorktreeConsoleInspectRequest,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListRequest,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightRequest,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePrepareRegenerationRequest,
  WorktreeConsolePreviewRequest,
  WorktreeConsoleRetryCleanupRequest,
  WorktreeConsoleResumeRevisionRequest,
  WorktreeConsoleRollbackPreviewRequest,
  WorktreeConsoleReviewDiffRequest,
  WorktreeConsoleReviewDiffResponse,
  WorktreeConsoleSetRetentionRequest,
  WorktreeConsoleTargetDetails,
} from '../../src/console-contract.js'

export type WorktreeConsoleFixtureMethod = keyof WorktreeConsoleAdapter

export interface WorktreeConsoleFixtureCall {
  method: WorktreeConsoleFixtureMethod
  request: unknown
}

function readyTarget(): WorktreeConsoleTargetDetails {
  return {
    project: { id: 'project-1', name: 'Fixture Project' },
    checkoutId: 'checkout-1',
    sourceSessionId: 'source-session',
    ownerSessionId: 'target-session',
    targetSessionId: 'target-session',
    iteration: 1,
    revision: 7,
    state: 'ready_for_review',
    phase: 'ready',
    dirty: true,
    currentOid: 'b'.repeat(40),
    sourceOid: 'a'.repeat(40),
    currentBranch: null,
    commitOid: null,
    managedRoot: '/fixture/project-worktrees/checkout-1',
    sourceRoot: '/fixture/project',
    capabilities: {
      create: false,
      open: true,
      inspect: true,
      discard: true,
      preflight: true,
      preview: true,
      resumeRevision: true,
      rollbackPreview: false,
      finalize: true,
      finalizePreview: false,
      setRetention: false,
      retryCleanup: false,
      beginNextIteration: false,
    },
    review: {
      reviewId: 'review-1',
      revision: 7,
      iteration: 1,
      preparedAt: 1,
      summary: 'Fixture review',
      validationStatus: 'passed',
      validationSummary: 'focused tests passed',
      tests: [{ command: 'pnpm test', status: 'passed' }],
      changedFiles: ['src/index.ts'],
      suggestedCommitMessage: 'fix: fixture review',
    },
  }
}

function outcome<T>(value: T): WorktreeConsoleOutcome<T> {
  return { ok: true, value }
}

export interface WorktreeConsoleAdapterFixture {
  adapter: WorktreeConsoleAdapter
  calls: WorktreeConsoleFixtureCall[]
  target: WorktreeConsoleTargetDetails
}

/** Shared deterministic fake used by the three parallel Worktree Console tracks. */
export function createWorktreeConsoleAdapterFixture(): WorktreeConsoleAdapterFixture {
  const calls: WorktreeConsoleFixtureCall[] = []
  const target = readyTarget()
  const record = <TRequest>(method: WorktreeConsoleFixtureMethod, request: TRequest): void => {
    calls.push({ method, request })
  }
  const delivered = (): WorktreeConsoleMutationResponse => {
    const { managedRoot: _managedRoot, sourceRoot: _sourceRoot, sourceOid: _sourceOid, currentBranch: _currentBranch, ...summary } = target
    return {
      target: {
        ...summary,
        state: 'delivered',
        phase: 'discarded',
        dirty: false,
        commitOid: 'c'.repeat(40),
        deliveryProof: {
          localBranch: 'main',
          localHeadBefore: 'a'.repeat(40),
          localHeadAfter: 'c'.repeat(40),
          changedFiles: ['src/index.ts'],
          validationStatus: target.review?.validationStatus,
          validationSummary: target.review?.validationSummary,
          commitInLocalHistory: true,
        },
        capabilities: {
          create: false,
          open: false,
          inspect: true,
          discard: false,
          preflight: false,
          preview: false,
          resumeRevision: false,
          rollbackPreview: false,
          finalize: false,
          finalizePreview: false,
          setRetention: false,
          retryCleanup: false,
          beginNextIteration: true,
        },
      },
      changedFiles: ['src/index.ts'],
      commitOid: 'c'.repeat(40),
    }
  }

  const adapter: WorktreeConsoleAdapter = {
    async current(request: WorktreeConsoleCurrentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>> {
      record('current', request)
      return outcome({ target })
    },
    async list(request: WorktreeConsoleListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>> {
      record('list', request)
      return outcome({ project: target.project, worktrees: [target] })
    },
    async create(request: WorktreeConsoleCreateRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>> {
      record('create', request)
      return outcome({ target, targetSessionId: target.ownerSessionId, managedRoot: target.managedRoot! })
    },
    async inspect(request: WorktreeConsoleInspectRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>> {
      record('inspect', request)
      return outcome({ target })
    },
    async reviewDiff(request: WorktreeConsoleReviewDiffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>> {
      record('reviewDiff', request)
      return outcome({
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
        files: [{ path: 'src/index.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new\n', truncated: false }],
        truncated: false,
      })
    },
    async preflight(request: WorktreeConsolePreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>> {
      record('preflight', request)
      return outcome({
        preflight: {
          status: 'ready', localModified: false, checkoutId: request.checkoutId, reviewId: request.expectedReviewId,
          revision: request.expectedRevision, configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40),
          baseStrategy: 'recorded_base', localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40),
          changedFiles: ['src/index.ts'],
        },
      })
    },
    async preview(request: WorktreeConsolePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('preview', request)
      return outcome({ target: {
        ...target,
        state: 'preview_active',
        revision: target.revision + 1,
        capabilities: { ...target.capabilities, preflight: false, preview: false, resumeRevision: false, rollbackPreview: true, finalize: false, finalizePreview: true },
      }, changedFiles: ['src/index.ts'] })
    },
    async resumeRevision(request: WorktreeConsoleResumeRevisionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('resumeRevision', request)
      const {
        review: _review,
        reviewSlot: _slot,
        managedRoot: _managedRoot,
        sourceRoot: _sourceRoot,
        sourceOid: _sourceOid,
        currentBranch: _currentBranch,
        ...working
      } = target
      const recoveryContinuation = request.conflictContinuation ? {
        ...request.conflictContinuation,
        requestId: 'host-authority-conflict-1',
        revision: target.revision + 1,
      } : undefined
      return outcome({ target: {
        ...working,
        state: 'working',
        revision: target.revision + 1,
        ...(recoveryContinuation ? { recoveryContinuation } : {}),
        capabilities: {
          ...target.capabilities,
          preflight: false,
          preview: false,
          resumeRevision: false,
          rollbackPreview: false,
          finalize: false,
          finalizePreview: false,
        },
      }, ...(recoveryContinuation ? { recoveryContinuation } : {}) })
    },
    async prepareReviewRegeneration(request: WorktreeConsolePrepareRegenerationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('prepareReviewRegeneration', request)
      const recoveryContinuation = {
        kind: 'worktree_review_regeneration' as const,
        requestId: 'host-authority-regeneration-1',
        checkoutId: request.checkoutId,
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
      }
      return outcome({
        target: { ...target, recoveryContinuation },
        recoveryContinuation,
      })
    },
    async rollbackPreview(request: WorktreeConsoleRollbackPreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('rollbackPreview', request)
      if (request.resumeRevision) {
        const { review: _review, reviewSlot: _slot, ...working } = target
        return outcome({ target: {
          ...working,
          state: 'working',
          revision: target.revision + 1,
          capabilities: { ...target.capabilities, preflight: false, preview: false, resumeRevision: false, rollbackPreview: false, finalize: false, finalizePreview: false },
        }, changedFiles: ['src/index.ts'] })
      }
      return outcome({ target: { ...target, revision: target.revision + 1 }, changedFiles: ['src/index.ts'] })
    },
    async discard(request: WorktreeConsoleDiscardRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('discard', request)
      return outcome(delivered())
    },
    async finalize(request: WorktreeConsoleFinalizeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('finalize', request)
      return outcome(delivered())
    },
    async finalizePreview(request: WorktreeConsoleFinalizePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('finalizePreview', request)
      return outcome(delivered())
    },
    async setRetention(request: WorktreeConsoleSetRetentionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('setRetention', request)
      return outcome({ target: { ...target, state: 'retained', phase: 'retained', retention: request.retention } })
    },
    async retryCleanup(request: WorktreeConsoleRetryCleanupRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('retryCleanup', request)
      return outcome(delivered())
    },
    async beginNextIteration(request: WorktreeConsoleBeginNextIterationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
      record('beginNextIteration', request)
      const {
        review: _review,
        reviewSlot: _slot,
        managedRoot: _managedRoot,
        sourceRoot: _sourceRoot,
        sourceOid: _sourceOid,
        currentBranch: _currentBranch,
        ...working
      } = target
      return outcome({ target: {
        ...working,
        checkoutId: 'checkout-2',
        iteration: target.iteration + 1,
        revision: request.expectedRevision + 2,
        state: 'working',
        phase: 'ready',
        dirty: false,
        commitOid: null,
        capabilities: { ...target.capabilities, preflight: false, preview: false, resumeRevision: false, finalize: false, beginNextIteration: false },
      } })
    },
  }

  return { adapter, calls, target }
}
