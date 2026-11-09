import { useEffect, useRef, useState } from 'react'
import type { DeferredWorktreeState, WorktreeConsoleAdapter } from '../../console-contract.js'
import type { PreSessionWorktreeServices } from '../actions.js'
import { useClientTranslator } from '../i18n.js'

/** Native composer keeps the draft, attachments, and Session identity unchanged. */
export function DeferredWorktreeToggle({ sessionId, blank, adapter, services, legacy }: {
  sessionId: string; blank: boolean; adapter: WorktreeConsoleAdapter
  services: PreSessionWorktreeServices; legacy: React.ReactNode
}) {
  const t = useClientTranslator()
  const [state, setState] = useState<DeferredWorktreeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scope = useRef({ sessionId, alive: true, busy: false, revision: 0 })
  if (scope.current.sessionId !== sessionId) {
    scope.current.alive = false
    scope.current = { sessionId, alive: true, busy: false, revision: 0 }
  }
  const current = scope.current
  useEffect(() => {
    current.alive = true
    setState(null)
    setError(null)
    setBusy(false)
    let pending = false
    const refresh = async () => {
      if (pending || current.busy || !adapter.deferredWorktree) return
      pending = true
      const revision = current.revision
      try {
        const result = await adapter.deferredWorktree({ sessionId })
        if (!current.alive || revision !== current.revision) return
        if (result.ok) setState(result.value)
        else setError(result.error.message)
      } catch (cause) { if (current.alive) setError(String(cause)) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => { current.alive = false; clearInterval(timer) }
  }, [sessionId, adapter])

  if (!adapter.deferredWorktree || state?.supported === false) return <>{legacy}</>
  if (!state) return error && blank ? <span role="alert">{error}</span> : null
  if ((!blank && !state.requested) || state.phase === 'ready') return null
  const change = async (retry = false) => {
    if (current.busy) return
    current.busy = true
    current.revision += 1
    setBusy(true)
    setError(null)
    const blocks = services.conversation.blocks
    const previous = blocks.storeFor(sessionId).getSnapshot()
    const block = { reason: t('deferred.saving') }
    blocks.set(sessionId, block)
    try {
      const result = await adapter.deferredWorktree!({ sessionId, ...(retry ? { retry: true } : { requested: !state.requested }) })
      if (!current.alive) return
      if (result.ok) setState(result.value)
      else setError(result.error.message)
    } catch (cause) { if (current.alive) setError(String(cause)) }
    finally {
      current.busy = false
      if (blocks.storeFor(sessionId).getSnapshot() === block) blocks.set(sessionId, previous)
      if (current.alive) setBusy(false)
    }
  }
  return <div className="flex items-center gap-2 text-xs">
    <label title={t('deferred.hint')} className="flex items-center gap-1">
      <input type="checkbox" checked={state.requested} disabled={busy || state.locked} onChange={() => { void change() }} />Worktree
    </label>
    {state.phase === 'creating' && <span role="status">{t('deferred.creating')}</span>}
    {(state.error || error) && <span role="alert">{error ?? state.error}</span>}
    {state.phase === 'failed' && <button disabled={busy} onClick={() => { void change(true) }}>{t('deferred.retry')}</button>}
  </div>
}
