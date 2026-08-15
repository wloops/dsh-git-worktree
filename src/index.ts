/**
 * dsh-git-worktree plugin entry. The session-checkout domain (state machine,
 * apply engine, ports) is Domi-ported and host-agnostic; this file is the DSH
 * plugin face: exports the domain error type and module contract, builds the
 * DSH adapters, mounts the state machine, and registers safe model tools,
 * human `/worktree` acceptance commands, and Session Target runtime context.
 * @module dsh-git-worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ManagedWorktreeSummaryView,
  BulkCleanupManagedWorktreeCandidate,
  BulkCleanupManagedWorktreesResult,
  SessionCheckoutErrorCode,
  SessionCheckoutOperation,
  SessionCheckoutOperationResult,
  SessionTargetBindChoice,
  SessionTargetView,
  WorktreeRetentionMode,
  WorktreeValidationItem,
  WorktreeValidationStatus,
  WorktreeApplyPreflightView,
} from './types.js'

/** Stable domain failure raised by the session-checkout state machine and its adapters. */
export class SessionCheckoutError extends Error {
  readonly code: SessionCheckoutErrorCode

  /**
   * @param code - stable error code from `SESSION_CHECKOUT_ERROR_CODES`.
   * @param message - user-facing message, surfaced verbatim by tools.
   */
  constructor(code: SessionCheckoutErrorCode, message: string) {
    super(message)
    this.name = 'SessionCheckoutError'
    this.code = code
  }
}

export interface SessionCheckoutReconcileSummary {
  recoveryRequiredCheckoutIds: string[]
  orphanedCheckoutIds: string[]
  dirtyOrphanedCheckoutIds: string[]
  retainedCheckoutCount: number
}

export interface ManageManagedWorktreeInput {
  checkoutId: string
  expectedRevision: number
  action: 'cleanup_retained' | 'retry_cleanup' | 'set_retention' | 'discard'
  retention?: Exclude<WorktreeRetentionMode, 'cleanup'>
  confirmDirty?: boolean
}

export interface ListManagedWorktreesInput {
  projectId?: string
  needsAttention?: boolean
  checkoutId?: string
  includeDiagnostics?: boolean
}

export interface MarkReadyForReviewInput {
  detailsMarkdown?: string
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  suggestedCommitMessage: string
}

/** Handoff data used by the client to create the authoritative isolated Workspace/Session. */
export interface IsolatedTargetLaunch {
  targetSessionId: string
  managedRoot: string
  target: SessionTargetView
}

/** Complete core interface the session-checkout module exposes to business callers. */
export interface SessionCheckoutModule {
  inspect(sessionId: string): Promise<SessionTargetView>
  /** Synchronous registry snapshot for replay-stable model runtime context. */
  runtimeContext(sessionId: string): string
  /** Read-only sync preflight; modifies no Local, worktree, registry, review state, or Git refs. */
  preflight?(sessionId: string, expectedRevision: number): Promise<WorktreeApplyPreflightView>
  /** Cross-module mutation under the same exclusive lock as bind/apply/discard/cleanup. */
  runExclusiveSessionMutation<T>(
    sessionId: string,
    operation: (target: SessionTargetView) => Promise<T>,
  ): Promise<T>
  bind(sessionId: string, choice: SessionTargetBindChoice): Promise<SessionTargetView>
  /** Reserve a distinct owner session and checkout without changing the source session cwd/identity. */
  createIsolatedTarget(sourceSessionId: string, targetSessionId: string): Promise<IsolatedTargetLaunch>
  /** Lazily create the next isolated checkout when a delivered owner session needs code changes. */
  beginNextIteration(sessionId: string): Promise<SessionTargetView>
  markReadyForReview(sessionId: string, input: MarkReadyForReviewInput): Promise<SessionTargetView>
  operate(input: SessionCheckoutOperation): Promise<SessionCheckoutOperationResult>
  listManagedWorktrees(input?: ListManagedWorktreesInput): Promise<ManagedWorktreeSummaryView[]>
  /** Caller-scoped list for model and human session surfaces. */
  listManagedWorktreesForSession(sessionId: string, input?: Omit<ListManagedWorktreesInput, 'projectId'>): Promise<ManagedWorktreeSummaryView[]>
  /** Caller-scoped management; never treats persisted owner ids as authorization. */
  manageManagedWorktreeForSession(sessionId: string, input: ManageManagedWorktreeInput): Promise<ManagedWorktreeSummaryView>
  /** Main-owned read-only cleanup inspection; writes no registry, refs, or directories. */
  inspectManagedWorktreeCleanup(input?: ListManagedWorktreesInput): Promise<ManagedWorktreeSummaryView[]>
  bulkCleanupManagedWorktrees(candidates: BulkCleanupManagedWorktreeCandidate[]): Promise<BulkCleanupManagedWorktreesResult>
  manageManagedWorktree(input: ManageManagedWorktreeInput): Promise<ManagedWorktreeSummaryView>
  /** Resolve a managed checkout's canonical root after identity validation (workspace registration). */
  resolveManagedRoot(checkoutId: string): Promise<string>
  cleanupExpiredRetained(now?: number): Promise<string[]>
  reconcile(): Promise<SessionCheckoutReconcileSummary>
}

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createDshGitPort } from './adapters/git.js'
import { createNodeFilesPort } from './adapters/files.js'
import { AtomicJsonCheckoutRegistry } from './adapters/registry.js'
import { createDshLookupPort } from './adapters/lookup.js'
import { createSessionCheckoutApplyEngine } from './session-checkout-apply.js'
import { createSessionCheckoutModule } from './session-checkout-module.js'
import { registerTools } from './tools.js'
import { registerWorktreeCommand } from './commands.js'
import { registerSessionTargetContext } from './session-target-context.js'

export * from './console-contract.js'

const name = 'git-worktree'
// Named export: the loader reads inject/apply named exports as plugin
// metadata. A bare function export mounts with no injection list, and the
// first ctx.tools access then fails with "cannot get property without inject".
export const inject = ['tools', 'commands', 'subprocess']

const Config = z.object({
  /**
   * Plugin state directory (registry, disabled-hooks root). Defaults to
   * `$DSH_HOME/plugins/dsh-git-worktree` (`~/.dsh` when `DSH_HOME` is unset).
   * The property is optional by construction (schemastery object properties
   * are optional inputs).
   */
  stateDir: z.string(),
})

function resolveStateDir(config: { stateDir?: string }): string {
  if (config.stateDir) return resolve(config.stateDir)
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'plugins', 'dsh-git-worktree')
}

const RETENTION_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000

/**
 * Mount the plugin: DSH adapters, the session-checkout module, safe worktree
 * tools, human acceptance command, dynamic target context, startup recovery,
 * and the retention-expiry timer.
 */
export function apply(ctx: Context, config: { stateDir?: string } = {}): void {
  const stateDir = resolveStateDir(config)
  mkdirSync(stateDir, { recursive: true })
  const hooksPath = join(stateDir, 'disabled-git-hooks')
  mkdirSync(hooksPath, { recursive: true })

  const module = createSessionCheckoutModule({
    lookup: createDshLookupPort(ctx),
    git: createDshGitPort(ctx, { hooksPath }),
    files: createNodeFilesPort(),
    registry: new AtomicJsonCheckoutRegistry(join(stateDir, 'managed-checkouts.json')),
    applyEngine: createSessionCheckoutApplyEngine(),
    managedCheckoutsRoot: stateDir,
    createCheckoutId: randomUUID,
  })

  registerTools(ctx, module)
  registerWorktreeCommand(ctx, module)
  registerSessionTargetContext(ctx, module)

  // Startup recovery plus periodic expiry of retained worktrees. cordis's
  // typed Events map omits the runtime 'ready' event; the events service's
  // loose runtime signature covers it.
  const reconcileOnReady = ctx.events.on('ready', () => {
    void module.reconcile().catch((error) => {
      console.warn('[dsh-git-worktree] reconcile failed:', error)
    })
  })
  const retentionTimer = setInterval(() => {
    void module.cleanupExpiredRetained().catch((error) => {
      console.warn('[dsh-git-worktree] retained worktree maintenance failed:', error)
    })
  }, RETENTION_MAINTENANCE_INTERVAL_MS)
  retentionTimer.unref?.()
  ctx.effect(() => () => {
    reconcileOnReady()
    clearInterval(retentionTimer)
  })
}
