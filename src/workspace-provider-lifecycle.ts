import type { Context, FiberState } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'

export const WORKSPACE_PROVIDER_CONDITION = "!!get('worktreeWorkspaceProvider') && [...loader.entries()].some(entry => entry.options?.name === 'dsh-git-worktree' && !entry.disabled)"

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreeWorkspaceProvider: boolean
  }
}
const OFFICIAL_WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'
// Cordis exposes FiberState as a declaration-only const enum, not a JS export.
const UNLOADING: FiberState = 5

/**
 * Reconcile the conditional patch with the public Loader lifecycle. A disabled
 * expression is evaluated dynamically, but the Web module registry caches rows
 * by plugin name; a change to the replacement alone does not re-elect Workspace.
 * Restarting the official entry through Loader operations publishes real module
 * events without saving any disabled flag or changing the user's profile.
 */
export async function mountWorkspaceProviderLifecycle(ctx: Context): Promise<void> {
  const loader = ctx.loader
  const owned = (): Entry[] => [...loader.entries()].filter(entry => {
    const disabled = entry.options.disabled as unknown
    return entry.options.name === OFFICIAL_WORKSPACE
      && typeof disabled === 'object' && disabled !== null
      && '__jsExpr' in disabled && disabled.__jsExpr === WORKSPACE_PROVIDER_CONDITION
  })
  let released = false
  let pending = Promise.resolve()
  const reconcile = (): Promise<void> => {
    pending = pending.then(async () => {
      if (released) return
      for (const entry of owned()) {
        if (entry.disabled) {
          if (!released) await entry.update({}, false, true)
        } else {
          await entry.refresh()
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
  await reconcile()
}
