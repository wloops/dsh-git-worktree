import type { Context, FiberState } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { hostWorkspaceClientFlavor, type WorkspaceClientFlavor } from './host-compat.js'

export const WORKSPACE_PROVIDER_CONDITION = "!!get('worktreeWorkspaceProvider') && [...loader.entries()].some(entry => entry.options?.name === 'dsh-git-worktree' && !entry.disabled)"

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreeWorkspaceProvider: boolean
  }
}
const OFFICIAL_WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'
// Cordis exposes FiberState as a declaration-only const enum, not a JS export.
const UNLOADING: FiberState = 5
// One Loader election operation that has not settled by this ceiling stops
// blocking the chain: plugin activation must never depend on the Host's
// concurrent entry startup unwinding first (a wedged official-fiber dispose
// would otherwise starve every Remote, tool, and command mount).
const DEFAULT_OPERATION_TIMEOUT_MS = 10_000

/** Tuning seams for {@link mountWorkspaceProviderLifecycle} (tests). */
export interface WorkspaceProviderLifecycleOptions {
  /** Ceiling for a single Loader disable/restore operation in milliseconds. */
  operationTimeoutMs?: number
}

/**
 * Reconcile the conditional patch with the public Loader lifecycle. A disabled
 * expression is evaluated dynamically, but the Web module registry caches rows
 * by plugin name; a change to the replacement alone does not re-elect Workspace.
 * Restarting the official entry through Loader operations publishes real module
 * events without saving any disabled flag or changing the user's profile.
 *
 * Election never blocks (or fails) plugin activation: Host boots start entries
 * concurrently, so the official entry's disable may race a fiber that is still
 * starting, and Loader versions differ in how such a dispose settles. Each
 * operation therefore races a ceiling; a wedged one is reported once and the
 * entry stays guarded until the real operation settles, while the next Loader
 * event retries the election. The disabled expression itself already keeps any
 * not-yet-started official entry out of the Web module graph, so the Web side
 * never observes two `uiWorkspace` providers from a slow reconciliation.
 */
export function mountWorkspaceProviderLifecycle(
  ctx: Context,
  flavor: WorkspaceClientFlavor = hostWorkspaceClientFlavor(),
  options: WorkspaceProviderLifecycleOptions = {},
): void {
  if (flavor === 'unsupported') {
    ctx.logger.warn('No pinned Workspace Browser for this Host generation; leaving the official Workspace provider active.')
    return
  }
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
  const loader = ctx.loader
  const owned = (): Entry[] => [...loader.entries()].filter(entry => {
    const disabled = entry.options.disabled as unknown
    return entry.options.name === OFFICIAL_WORKSPACE
      && typeof disabled === 'object' && disabled !== null
      && '__jsExpr' in disabled && disabled.__jsExpr === WORKSPACE_PROVIDER_CONDITION
  })
  let released = false
  let pending = Promise.resolve()
  // Entries whose real Loader operation is still in flight (possibly past the
  // ceiling). Later reconciles skip them until the operation itself settles,
  // which keeps at most one Loader mutation per entry alive at any time.
  const inFlight = new Set<string>()
  const operate = (entry: Entry, kind: 'disable' | 'restore'): Promise<void> => new Promise(resolve => {
    const key = entry.id
    const label = kind === 'disable' ? 'official Workspace disable' : 'official Workspace restore'
    let operation: Promise<unknown>
    try {
      operation = kind === 'disable' ? entry.update({}, false, true) : entry.refresh()
    } catch (error) {
      ctx.logger.warn(`dsh-git-worktree: ${label} threw during Loader reconciliation`, error)
      resolve()
      return
    }
    const settle = (): void => { inFlight.delete(key) }
    inFlight.add(key)
    void operation.then(settle, settle)
    const timer = setTimeout(() => {
      ctx.logger.warn(
        `dsh-git-worktree: ${label} did not settle within ${String(operationTimeoutMs)}ms; `
        + 'plugin activation continues and election retries on the next Loader event.',
      )
      resolve()
    }, operationTimeoutMs)
    timer.unref?.()
    void operation.then(
      () => { clearTimeout(timer); settle(); resolve() },
      error => {
        clearTimeout(timer)
        settle()
        ctx.logger.warn(`dsh-git-worktree: ${label} failed during Loader reconciliation`, error)
        resolve()
      },
    )
  })
  const reconcile = (): Promise<void> => {
    pending = pending.then(async () => {
      if (released) return
      for (const entry of owned()) {
        if (inFlight.has(entry.id)) continue
        let disabled: boolean
        try {
          disabled = entry.disabled
        } catch (error) {
          ctx.logger.warn('dsh-git-worktree: could not evaluate the official Workspace disabled expression', error)
          continue
        }
        if (disabled) {
          if (!released) await operate(entry, 'disable')
        } else {
          await operate(entry, 'restore')
        }
      }
    })
    return pending
  }
  ctx.effect(() => async () => {
    released = true
    // Root/Include teardown owns these entries; do not resurrect that tree.
    if (ctx.root.fiber.uid === null || ctx.root.fiber.state === UNLOADING) return
    await pending.catch(() => {})
    for (const entry of owned()) {
      if (entry.parent.ctx.fiber.uid !== null && entry.parent.ctx.fiber.state !== UNLOADING && !entry.disabled) await entry.refresh()
    }
  })
  // Registered after the fallback so LIFO teardown releases the selection
  // before restoring Workspace, including when the replacement apply fails.
  ctx.provide('worktreeWorkspaceProvider', true)
  // Includes may add the official row after the replacement has activated.
  ctx.on('internal/status', fiber => {
    if (fiber === ctx.fiber && !released) {
      void reconcile().catch(error => ctx.logger.warn(error))
    }
  })
  ctx.on('internal/plugin', fiber => {
    if (fiber.uid && fiber.entry?.options.name === OFFICIAL_WORKSPACE) {
      void reconcile().catch(error => ctx.logger.warn(error))
    }
  })
  // Deliberately fire-and-forget: this pass only stops an official fiber that
  // raced ahead during concurrent boot; activation itself must not wait on it.
  void reconcile().catch(error => ctx.logger.warn(error))
}
