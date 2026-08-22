import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsolePreflightRequest,
} from '../../console-contract.js'
import type { WorktreeApplyPreflightView } from '../../types.js'

export type PreflightSnapshot =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; preflight: WorktreeApplyPreflightView }
  | { status: 'error'; error: WorktreeConsoleError }

interface Entry {
  snapshot: PreflightSnapshot
  listeners: Set<() => void>
  promise?: Promise<PreflightSnapshot>
  generation: number
}

const IDLE: PreflightSnapshot = { status: 'idle' }
const caches = new WeakMap<WorktreeConsoleAdapter, Map<string, Entry>>()

function identityKey(identity: WorktreeConsolePreflightRequest): string {
  return [identity.sessionId, identity.checkoutId, identity.expectedRevision, identity.expectedReviewId].join('\u0000')
}

function cacheFor(adapter: WorktreeConsoleAdapter): Map<string, Entry> {
  let cache = caches.get(adapter)
  if (!cache) {
    cache = new Map()
    caches.set(adapter, cache)
  }
  return cache
}

function entryFor(adapter: WorktreeConsoleAdapter, identity: WorktreeConsolePreflightRequest): Entry {
  const cache = cacheFor(adapter)
  const key = identityKey(identity)
  let entry = cache.get(key)
  if (!entry) {
    entry = { snapshot: IDLE, listeners: new Set(), generation: 0 }
    cache.set(key, entry)
  }
  return entry
}

function publish(entry: Entry, snapshot: PreflightSnapshot): void {
  entry.snapshot = snapshot
  for (const listener of entry.listeners) listener()
}

/** Shared read-only request. `force` bypasses cached success and is mandatory before writes. */
export async function readReviewPreflight(
  adapter: WorktreeConsoleAdapter,
  identity: WorktreeConsolePreflightRequest,
  force = false,
): Promise<PreflightSnapshot> {
  const entry = entryFor(adapter, identity)
  if (entry.promise) return entry.promise
  if (!force && (entry.snapshot.status === 'success' || entry.snapshot.status === 'error')) return entry.snapshot
  publish(entry, { status: 'loading' })
  const generation = entry.generation
  const promise: Promise<PreflightSnapshot> = adapter.preflight(identity).then((outcome): PreflightSnapshot => {
    const snapshot: PreflightSnapshot = outcome.ok
      ? { status: 'success', preflight: outcome.value.preflight }
      : { status: 'error', error: outcome.error }
    if (entry.generation === generation) publish(entry, snapshot)
    return snapshot
  }, (reason): PreflightSnapshot => {
    const snapshot: PreflightSnapshot = {
      status: 'error',
      error: { code: 'transport_unavailable', message: reason instanceof Error ? reason.message : String(reason) },
    }
    if (entry.generation === generation) publish(entry, snapshot)
    return snapshot
  }).finally(() => {
    if (entry.generation === generation) entry.promise = undefined
  })
  entry.promise = promise
  return promise
}

/** Discard one identity result; in-flight reads still publish only to the orphaned entry. */
export function invalidateReviewPreflight(
  adapter: WorktreeConsoleAdapter,
  identity: WorktreeConsolePreflightRequest,
): void {
  const entry = cacheFor(adapter).get(identityKey(identity))
  if (!entry) return
  entry.generation += 1
  entry.promise = undefined
  publish(entry, IDLE)
}

export function useReviewPreflight(
  adapter: WorktreeConsoleAdapter | null | undefined,
  identity: WorktreeConsolePreflightRequest | undefined,
  enabled: boolean,
): { snapshot: PreflightSnapshot; refresh(): Promise<PreflightSnapshot> } {
  const key = identity ? identityKey(identity) : ''
  const subscribe = useCallback((listener: () => void) => {
    if (!adapter || !identity) return () => undefined
    const entry = entryFor(adapter, identity)
    entry.listeners.add(listener)
    return () => { entry.listeners.delete(listener) }
  }, [adapter, key])
  const getSnapshot = useCallback(() => {
    if (!adapter || !identity) return IDLE
    return entryFor(adapter, identity).snapshot
  }, [adapter, key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (adapter && identity && enabled) void readReviewPreflight(adapter, identity)
  }, [adapter, enabled, key])

  return {
    snapshot,
    refresh: useCallback(async () => {
      if (!adapter || !identity) return IDLE
      return readReviewPreflight(adapter, identity, true)
    }, [adapter, key]),
  }
}
