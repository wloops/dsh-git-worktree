import { useState } from 'react'
import { finalizeCurrentSession, type WorktreeClientServices } from './actions.js'
import { parseReviewTool, type ToolCallViewPropsLike } from './model.js'

type Retention = 'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual'
interface Props extends ToolCallViewPropsLike {
  services: WorktreeClientServices
}

const RETENTION_LABELS: Array<{ mode: Retention; label: string }> = [
  { mode: 'retain_24h', label: '保留 24 小时' },
  { mode: 'retain_3d', label: '保留 3 天' },
  { mode: 'retain_manual', label: '手动清理' },
]

export function WorktreeReviewRow({ block, inspect, services }: Props) {
  const model = parseReviewTool(block)
  const [submitting, setSubmitting] = useState<Retention | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const payload = model.payload
  const args = model.args
  const state = model.lifecycle === 'running' ? 'running' : model.lifecycle === 'ok' ? 'ok' : 'error'

  const finalize = async (retention: Retention): Promise<void> => {
    if (submitting) return
    setSubmitting(retention)
    setSubmitError(null)
    try {
      if (!payload) throw new Error('Review identity is unavailable.')
      await finalizeCurrentSession(services, payload.reviewId, payload.revision, retention)
    } catch (error) {
      setSubmitting(null)
      setSubmitError(error instanceof Error ? error.message : String(error))
    }
  }

  const visibleFiles = payload?.changedFiles.slice(0, 10) ?? []
  const hiddenFileCount = (payload?.changedFiles.length ?? 0) - visibleFiles.length
  return (
    <section className="dsh-wt-card" data-tool="worktree_ready_for_review" data-state={state} aria-label="Worktree Ready for Review">
      <header className="dsh-wt-head">
        <span className="dsh-wt-mark" aria-hidden />
        <strong className="dsh-wt-title">Ready for Review</strong>
        <span className="dsh-wt-subtitle">{args?.summary ?? (model.lifecycle === 'running' ? '正在冻结验收快照…' : '验收信息不可用')}</span>
        {args ? <span className="dsh-wt-badge" data-validation={args.validationStatus}>{args.validationStatus}</span> : null}
      </header>
      {payload && args ? (
        <div className="dsh-wt-body">
          {args.validationSummary ? <div className="dsh-wt-status">{args.validationSummary}</div> : null}
          <div className="dsh-wt-files" aria-label={`${payload.changedFiles.length} changed files`}>
            {visibleFiles.map((file) => <span className="dsh-wt-file" title={file} key={file}>{file}</span>)}
            {hiddenFileCount > 0 ? <span className="dsh-wt-file">+{hiddenFileCount}</span> : null}
            {payload.changedFiles.length === 0 ? <span className="dsh-wt-status">No task delta</span> : null}
          </div>
          <div>
            <div className="dsh-wt-label">建议 Commit Message</div>
            <pre className="dsh-wt-commit dsh-wt-code">{args.suggestedCommitMessage}</pre>
          </div>
          {(args.tests.length > 0 || args.details) ? (
            <details className="dsh-wt-details">
              <summary className="dsh-wt-summary">验证与交付详情</summary>
              {args.tests.length > 0 ? (
                <ul className="dsh-wt-test-list">
                  {args.tests.map((test, index) => (
                    <li className="dsh-wt-test" key={`${test.command}-${index}`}>
                      <span className="dsh-wt-test-state">{test.status}</span>
                      <span className="dsh-wt-test-command dsh-wt-code">{test.command}{test.summary ? ` — ${test.summary}` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {args.details ? <pre className="dsh-wt-commit">{args.details}</pre> : null}
            </details>
          ) : null}
          <div className="dsh-wt-actions">
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={submitting !== null} onClick={() => void finalize('cleanup')}>
              {submitting === 'cleanup' ? '正在提交…' : '提交并清理'}
            </button>
            <details className="dsh-wt-retain">
              <summary className="dsh-wt-summary">提交后保留环境</summary>
              <div className="dsh-wt-retain-actions">
                {RETENTION_LABELS.map(({ mode, label }) => (
                  <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={() => void finalize(mode)} key={mode}>
                    {submitting === mode ? '正在提交…' : label}
                  </button>
                ))}
              </div>
            </details>
            {inspect ? <button type="button" className="dsh-wt-button" onClick={inspect}>Inspect</button> : null}
          </div>
          <span className="dsh-wt-visually-hidden" aria-live="polite">{submitting ? '提交命令已发送' : ''}</span>
          {submitError ? <div className="dsh-wt-error" role="alert">{submitError}</div> : null}
        </div>
      ) : model.error ? (
        <div className="dsh-wt-body"><div className="dsh-wt-error" role="alert">{model.error}</div></div>
      ) : null}
    </section>
  )
}
