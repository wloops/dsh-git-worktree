import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  worktreeConsoleErrorMeta,
  type WorktreeConsoleAdapter,
  type WorktreeConsoleError,
  type WorktreeConsoleErrorCode,
  type WorktreeConsoleListResponse,
  type WorktreeConsoleMutationResponse,
  type WorktreeConsoleTargetDetails,
  type WorktreeConsoleTargetState,
  type WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import { openIsolatedTarget, type WorktreeClientServices } from '../actions.js'

export interface WorktreeConsoleViewProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
  focusCheckoutId?: string | null
  onTargetChange?(): void
}

const STATE_LABELS: Record<WorktreeConsoleTargetState, string> = {
  local: 'Local',
  creating: '创建中…',
  working: '修改中',
  ready_for_review: '待验收',
  preview_active: 'Local 验收中',
  preview_detached: '预览待恢复',
  retained: '已保留',
  cleanup_pending: '清理中',
  recovery_required: '需要恢复',
  delivered: '已交付',
}

interface ConsoleSnapshot {
  sessionId: string
  current: WorktreeConsoleTargetDetails
  list: WorktreeConsoleListResponse
}

function errorText(error: WorktreeConsoleError): string {
  const meta = worktreeConsoleErrorMeta(error.code)
  const next = {
    refresh: '请刷新以读取最新 Host 状态。',
    confirm_dirty: '请明确确认脏 Worktree 后重试。',
    open_recovery: '再次操作前请先查看恢复信息。',
    retry: '临时故障消失后可以重试。',
    none: '当前 Session 无权完成此操作。',
  }[meta.recovery]
  return `${error.code}: ${error.message} ${next}`
}

function retentionLabel(retention: NonNullable<WorktreeConsoleTargetSummary['retention']>): string {
  if (retention === 'retain_24h') return '保留 24 小时'
  if (retention === 'retain_3d') return '保留 3 天'
  return '手动清理'
}

function TargetState({ target }: { target: WorktreeConsoleTargetSummary }) {
  return (
    <span className="dsh-wtc-state" data-target-state={target.state}>
      <span className="dsh-wtc-state-dot" aria-hidden />
      {STATE_LABELS[target.state]}
    </span>
  )
}

const ATTENTION_RANK: Record<WorktreeConsoleTargetState, number> = {
  recovery_required: 0,
  preview_detached: 1,
  cleanup_pending: 2,
  ready_for_review: 3,
  preview_active: 4,
  retained: 5,
  working: 6,
  creating: 7,
  delivered: 8,
  local: 9,
}

/** Source-linked Worktree management surface backed only by WorktreeConsoleAdapter. */
export function WorktreeConsoleView({
  sessionId,
  adapter,
  services,
  focusCheckoutId,
  onTargetChange,
}: WorktreeConsoleViewProps) {
  const mounted = useRef(true)
  const request = useRef(0)
  const sessionGeneration = useRef(0)
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<WorktreeConsoleTargetSummary | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const visibleSnapshot = snapshot?.sessionId === sessionId ? snapshot : null

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    sessionGeneration.current += 1
    request.current += 1
    setSnapshot(null)
    setConfirmTarget(null)
    setPendingAction(null)
    setError(null)
    setLoading(true)
  }, [sessionId])

  const isActive = (generation: number): boolean =>
    mounted.current && sessionGeneration.current === generation

  const refresh = useCallback(async (clearError = true): Promise<void> => {
    const generation = sessionGeneration.current
    const token = ++request.current
    setLoading(true)
    if (clearError) setError(null)
    try {
      const [current, list] = await Promise.all([
        adapter.current({ sessionId }),
        adapter.list({ sessionId }),
      ])
      if (!isActive(generation) || token !== request.current) return
      if (!current.ok) {
        setError(errorText(current.error))
        return
      }
      if (!list.ok) {
        setError(errorText(list.error))
        return
      }
      setSnapshot({ sessionId, current: current.value.target, list: list.value })
    } catch (reason) {
      if (isActive(generation) && token === request.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (isActive(generation) && token === request.current) setLoading(false)
    }
  }, [adapter, sessionId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (confirmTarget !== null) confirmButton.current?.focus()
  }, [confirmTarget])

  const applyMutation = (response: WorktreeConsoleMutationResponse, generation: number): void => {
    if (!isActive(generation)) return
    setSnapshot(current => {
      if (current === null || current.sessionId !== sessionId) return current
      const target = response.target
      const nextCurrent = current.current.checkoutId === target.checkoutId
        ? { ...current.current, ...target }
        : current.current
      return {
        sessionId,
        current: nextCurrent,
        list: {
          ...current.list,
          worktrees: current.list.worktrees.map(row => row.checkoutId === target.checkoutId ? target : row),
        },
      }
    })
    onTargetChange?.()
  }

  const mutationError = (code: WorktreeConsoleErrorCode, message: string, generation: number): void => {
    if (!isActive(generation)) return
    setError(errorText({ code, message }))
    if (code === 'stale_target' || code === 'stale_local' || code === 'stale_isolated') {
      void refresh(false)
    }
  }

  const createTarget = async (): Promise<void> => {
    if (pendingAction !== null || visibleSnapshot?.current.capabilities.create !== true) return
    const generation = sessionGeneration.current
    const sourceProjectId = visibleSnapshot.current.project.id
    setPendingAction('create')
    setError(null)
    try {
      const outcome = await adapter.create({ sourceSessionId: sessionId })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        setError(errorText(outcome.error))
        return
      }
      const { target, targetSessionId, managedRoot } = outcome.value
      if (target.sourceSessionId !== sessionId) {
        throw new Error('Host 返回了属于其他 source Session 的目标。')
      }
      if (targetSessionId === sessionId) {
        throw new Error('Host 错误地把 source Session 作为 isolated target Session 返回。')
      }
      if (
        target.checkoutId === null
        || target.targetSessionId !== targetSessionId
        || target.ownerSessionId !== targetSessionId
        || target.managedRoot !== managedRoot
        || target.project.id !== sourceProjectId
        || !target.capabilities.open
      ) {
        throw new Error('Host 返回的 target Session 身份不一致。')
      }
      await openIsolatedTarget(services, { targetSessionId, managedRoot }, () => isActive(generation))
      if (!isActive(generation)) return
      setSnapshot(current => current === null || current.sessionId !== sessionId ? current : {
        sessionId,
        current: target,
        list: {
          ...current.list,
          worktrees: [
            ...current.list.worktrees.filter(row => row.checkoutId !== target.checkoutId),
            (() => {
              const { managedRoot: _root, sourceRoot: _sourceRoot, sourceOid: _source, currentBranch: _branch, ...summary } = target
              return summary
            })(),
          ],
        },
      })
      onTargetChange?.()
      void refresh()
    } catch (reason) {
      if (isActive(generation)) {
        setError(reason instanceof Error ? reason.message : String(reason))
        void refresh(false)
      }
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const discardTarget = async (target: WorktreeConsoleTargetSummary, confirmDirty: boolean): Promise<void> => {
    if (pendingAction !== null || target.checkoutId === null || !target.capabilities.discard) return
    const generation = sessionGeneration.current
    setConfirmTarget(null)
    setPendingAction(`discard:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.discard({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
        confirmDirty,
        ...(target.state === 'preview_active' || target.capabilities.rollbackPreview ? { rollbackPreview: true } : {}),
      })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      applyMutation(outcome.value, generation)
      void refresh()
    } catch (reason) {
      if (isActive(generation)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const retryCleanup = async (target: WorktreeConsoleTargetSummary): Promise<void> => {
    if (pendingAction !== null || target.checkoutId === null || !target.capabilities.retryCleanup) return
    const generation = sessionGeneration.current
    setPendingAction(`cleanup:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.retryCleanup({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
      })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      applyMutation(outcome.value, generation)
      void refresh()
    } catch (reason) {
      if (isActive(generation)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const openListedTarget = async (target: WorktreeConsoleTargetSummary): Promise<void> => {
    if (
      pendingAction !== null
      || target.checkoutId === null
      || !target.capabilities.open
      || !target.capabilities.inspect
    ) return
    const generation = sessionGeneration.current
    setPendingAction(`open:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.inspect({ sessionId, checkoutId: target.checkoutId })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      const detail = outcome.value.target
      if (!detail.capabilities.open) {
        throw new Error('最新 Host 状态已不允许打开该 Worktree。')
      }
      if (
        detail.checkoutId !== target.checkoutId
        || detail.project.id !== target.project.id
        || detail.sourceSessionId !== target.sourceSessionId
        || detail.ownerSessionId !== target.ownerSessionId
        || detail.targetSessionId !== target.targetSessionId
        || detail.targetSessionId !== detail.ownerSessionId
      ) {
        throw new Error('检查结果中的 target 身份不一致。')
      }
      if (detail.managedRoot === null || detail.targetSessionId === null) {
        throw new Error('已授权的 target 路径或 Session 身份不可用。')
      }
      await openIsolatedTarget(services, {
        managedRoot: detail.managedRoot,
        targetSessionId: detail.targetSessionId,
      }, () => isActive(generation))
    } catch (reason) {
      if (isActive(generation)) {
        setError(reason instanceof Error ? reason.message : String(reason))
        void refresh(false)
      }
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const orderedWorktrees = visibleSnapshot === null
    ? []
    : [...visibleSnapshot.list.worktrees].sort((left, right) => {
        const focusedLeft = left.checkoutId === focusCheckoutId ? 0 : 1
        const focusedRight = right.checkoutId === focusCheckoutId ? 0 : 1
        if (focusedLeft !== focusedRight) return focusedLeft - focusedRight
        const rank = ATTENTION_RANK[left.state] - ATTENTION_RANK[right.state]
        return rank !== 0 ? rank : right.iteration - left.iteration
      })

  if (loading && visibleSnapshot === null) {
    return <div className="dsh-wtc-loading" role="status" aria-live="polite">正在加载 Worktree 控制台…</div>
  }

  return (
    <section className="dsh-wtc-console" aria-label="Worktree 控制台">
      <header className="dsh-wtc-console-head">
        <div>
          <span className="dsh-wtc-kicker">SESSION TARGET</span>
          <h2>关联 Worktrees</h2>
        </div>
        <button type="button" className="dsh-wtc-button" disabled={loading} onClick={() => { void refresh() }}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>
      {error ? <div className="dsh-wtc-error" role="alert">{error}</div> : null}
      {visibleSnapshot ? (
        <>
          <section className="dsh-wtc-current" aria-label="当前目标">
            <div>
              <span className="dsh-wtc-label">当前目标</span>
              <strong>{visibleSnapshot.current.project.name}</strong>
            </div>
            <div className="dsh-wtc-current-actions">
              <TargetState target={visibleSnapshot.current} />
              {visibleSnapshot.current.state !== 'recovery_required' && visibleSnapshot.current.capabilities.create ? (
                <button
                  type="button"
                  className="dsh-wtc-button dsh-wtc-primary"
                  disabled={pendingAction !== null}
                  onClick={() => { void createTarget() }}
                >
                  {pendingAction === 'create' ? '创建中…' : '创建 Worktree'}
                </button>
              ) : null}
            </div>
          </section>
          <section className="dsh-wtc-list-section" aria-label="关联 Worktrees">
            <div className="dsh-wtc-section-head">
              <div>
                <span className="dsh-wtc-label">逻辑关联</span>
                <h3>{visibleSnapshot.list.project.name}</h3>
              </div>
              <span className="dsh-wtc-count">{visibleSnapshot.list.worktrees.length}</span>
            </div>
            {visibleSnapshot.list.worktrees.length === 0 ? (
              <div className="dsh-wtc-empty">这个项目还没有受管 Worktree。</div>
            ) : (
              <ul className="dsh-wtc-list">
                {orderedWorktrees.map(target => (
                  <li
                    className="dsh-wtc-row"
                    data-current-target={target.checkoutId === visibleSnapshot.current.checkoutId || undefined}
                    key={target.checkoutId ?? `local:${target.sourceSessionId}`}
                  >
                    <div className="dsh-wtc-row-main">
                      <div className="dsh-wtc-row-title">
                        <TargetState target={target} />
                        <span className="dsh-wtc-row-id">{target.checkoutId ?? 'Local source'}</span>
                        {target.checkoutId === visibleSnapshot.current.checkoutId ? <span className="dsh-wtc-relation">当前</span> : null}
                        {sessionId === target.sourceSessionId && sessionId !== target.ownerSessionId ? <span className="dsh-wtc-relation">来源</span> : null}
                        {sessionId !== target.sourceSessionId && sessionId !== target.ownerSessionId ? <span className="dsh-wtc-relation">关联任务</span> : null}
                      </div>
                      <div className="dsh-wtc-facts">
                        <span>第 {target.iteration} 轮</span>
                        {target.dirty ? <span>有未提交修改</span> : <span>干净</span>}
                        {target.retention ? <span>保留方式：{retentionLabel(target.retention)}</span> : null}
                        {target.expiresAt ? <span>到期时间：{new Date(target.expiresAt).toLocaleString()}</span> : null}
                        {target.cleanupMessage ? <span className="dsh-wtc-recovery-message">{target.cleanupMessage}</span> : null}
                      </div>
                    </div>
                    <div className="dsh-wtc-row-actions">
                      <span className="dsh-wtc-revision">r{target.revision}</span>
                      {target.capabilities.open && target.capabilities.inspect && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={`打开 ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => { void openListedTarget(target) }}
                        >
                          {pendingAction === `open:${target.checkoutId}` ? '打开中…' : '打开'}
                        </button>
                      ) : null}
                      {target.capabilities.discard && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button dsh-wtc-danger"
                          aria-label={`放弃 ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => {
                            if (target.dirty) setConfirmTarget(target)
                            else void discardTarget(target, false)
                          }}
                        >
                          {pendingAction === `discard:${target.checkoutId}` ? '放弃中…' : '放弃'}
                        </button>
                      ) : null}
                      {target.capabilities.retryCleanup && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={`重试清理 ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => { void retryCleanup(target) }}
                        >
                          {pendingAction === `cleanup:${target.checkoutId}` ? '重试中…' : '重试清理'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
      {confirmTarget !== null ? (
        <div
          className="dsh-wtc-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label="放弃有修改的 Worktree？"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setConfirmTarget(null)
          }}
        >
          <strong>放弃有修改的 Worktree？</strong>
          <p>
            {sessionId === confirmTarget.sourceSessionId && sessionId !== confirmTarget.ownerSessionId
              ? `Local source 将放弃预留目标 ${confirmTarget.checkoutId} 及其全部未提交修改。`
              : confirmTarget.state === 'preview_active' || confirmTarget.capabilities.rollbackPreview
                ? `将先安全撤回 ${confirmTarget.checkoutId} 的 Local Preview；只有撤回成功后才会删除 Worktree。`
                : `当前 Session 将放弃 Worktree ${confirmTarget.checkoutId} 及其全部未提交修改。`}
          </p>
          <div className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" onClick={() => { setConfirmTarget(null) }}>取消</button>
            <button
              ref={confirmButton}
              type="button"
              className="dsh-wtc-button dsh-wtc-danger"
              onClick={() => { void discardTarget(confirmTarget, true) }}
            >
              确认放弃修改
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
