import { useEffect, useRef } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeConsoleTargetSummary } from '../../console-contract.js'
import type { WorktreeApplyPreflightView } from '../../types.js'
import { useClientTranslator, type ClientTranslator } from '../i18n.js'
import { ReviewIcon, type ReviewIconName } from './ReviewIcon.js'

export function validationText(status: string, t: ClientTranslator): string {
  return t(status === 'passed' ? 'detail.passed' : status === 'failed' ? 'detail.failed' : status === 'partial' ? 'detail.partial' : 'detail.notRun')
}
export function validationIcon(status: string): ReviewIconName {
  return status === 'passed' ? 'check' : status === 'failed' || status === 'partial' ? 'warning' : 'minus'
}

export function ReviewDetailsModal({ open, onClose, target, preflight }: {
  open: boolean; onClose(): void; target: WorktreeConsoleTargetSummary; preflight?: WorktreeApplyPreflightView
}) {
  const t = useClientTranslator()
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = content.current?.closest<HTMLElement>('[role="dialog"]')
    if (!dialog) return
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]'))
    focusable()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0], last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  const review = target.review
  if (!review) return null
  const conflict = preflight?.status === 'conflict'
  const recovery = target.state === 'preview_detached' || target.state === 'recovery_required'
  const state = recovery ? 'detail.recovery' : conflict || preflight?.status === 'blocked' ? 'detail.blocked' : target.state === 'preview_active' ? 'detail.preview' : target.state === 'retained' || target.state === 'delivered' || target.state === 'cleanup_pending' ? 'detail.saved' : 'detail.ready'
  const note = recovery ? t('detail.recoveryNote') : conflict ? t('detail.conflictNote') : target.state === 'preview_active' ? t('detail.previewNote') : preflight?.status === 'blocked' ? preflight.message : target.cleanupMessage
  return <Modal open={open} onClose={onClose} title={t('detail.title')} headless className="dsh-wt-details-modal" contentClassName="dsh-wt-details-body">
    <header className="dsh-wt-details-header"><h1>{t('detail.title')}</h1><button type="button" aria-label={t('detail.close')} onClick={onClose}><ReviewIcon name="close" /></button></header>
    <div ref={content} className="dsh-wt-details-body">
    <div className="dsh-wt-details-heading"><h2>{review.summary}</h2><span className="dsh-wt-details-badge" data-tone={recovery || conflict ? 'warning' : 'neutral'}>{t(state)}</span></div>
    <p className="dsh-wt-details-muted">{t('detail.iteration', { count: review.iteration })}</p>
    <div className="dsh-wt-details-meta"><span><ReviewIcon name="file" />{t('count.files', { count: review.changedFiles.length })}</span><span data-validation={review.validationStatus}><ReviewIcon name={validationIcon(review.validationStatus)} />{validationText(review.validationStatus, t)}</span></div>
    {note ? <p className="dsh-wt-details-notice" data-tone={recovery || conflict || preflight?.status === 'blocked' ? 'warning' : 'neutral'}><ReviewIcon name={recovery || conflict ? 'warning' : 'list'} />{note}</p> : null}
    <section className="dsh-wt-details-section"><h3>{t('detail.files')}</h3><ul className="dsh-wt-details-files">{review.changedFiles.map(file => <li key={file}><ReviewIcon name="file" /><span>{file}</span>{conflict && preflight.conflictingFiles.includes(file) ? <span className="dsh-wt-details-badge" data-tone="warning">{t('detail.conflict')}</span> : null}</li>)}</ul></section>
    <section className="dsh-wt-details-section"><h3>{t('detail.validation')}</h3>
      {review.validationSummary ? <p className="dsh-wt-details-muted">{review.validationSummary}</p> : null}
      {review.tests.length ? <ul className="dsh-wt-details-tests">{review.tests.map((test, index) => <li key={index}><ReviewIcon name={validationIcon(test.status)} /><div><div className="dsh-wt-details-test-title"><span>{test.command}</span><span data-validation={test.status}>{validationText(test.status, t)}</span></div>{test.summary ? <p>{test.summary}</p> : null}</div></li>)}</ul> : <p className="dsh-wt-details-muted">{t('detail.noTests')}</p>}
    </section>
    <details className="dsh-wt-details-version"><summary><ReviewIcon name="chevron" /><ReviewIcon name="branch" />{t('detail.version')}</summary><dl><dt>{t('detail.reviewId')}</dt><dd>{review.reviewId}</dd><dt>{t('detail.revision')}</dt><dd>{target.revision}</dd><dt>{t('detail.commit')}</dt><dd>{target.currentOid}</dd></dl></details>
    </div>
  </Modal>
}
