import { useClientLanguage, useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import type { WorktreeConsoleTargetSummary } from '../../console-contract.js'

function shortOid(value: string): string {
  return value.slice(0, 8)
}

function validationLabel(status: NonNullable<WorktreeConsoleTargetSummary['deliveryProof']>['validationStatus'], t: ClientTranslator = defaultClientTranslator): string {
  if (status === 'passed') return t("validation.passed")
  if (status === 'failed') return t("validation.failed")
  if (status === 'partial') return t("partial.validation")
  if (status === 'not_run') return t("validation.not.run")
  return t("no.validation.summary")
}

export function DeliveryProof({ target, compact = false }: { target: WorktreeConsoleTargetSummary; compact?: boolean }) {
  const t = useClientTranslator()
  const language = useClientLanguage()

  const proof = target.deliveryProof
  if (!proof) return null
  const lifecycle = target.state === 'delivered'
    ? t("environment.cleaned.up")
    : target.state === 'retained'
      ? t("environment.retained", { p0: target.expiresAt ? t("until", { p0: new Date(target.expiresAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') }) : '' })
      : target.state === 'cleanup_pending'
        ? t("commit.created.environment.cleanup.pending")
        : t("delivery.evidence.recorded")
  if (compact) {
    return (
      <span className="dsh-wt-delivery-proof dsh-wt-delivery-proof-compact">
        {t("commit")} {target.commitOid ? shortOid(target.commitOid) : t("no.new.commit")} · {proof.localBranch ?? t("detached.head")}@{shortOid(proof.localHeadAfter)} · {t("count.files", { count: proof.changedFiles.length })} · {lifecycle}
      </span>
    )
  }
  return (
    <section className="dsh-wt-delivery-proof" aria-label={t("delivery.proof")}>
      <header><strong>{t("delivery.proof.2")}</strong><span>{lifecycle}</span></header>
      <dl>
        <div><dt>{t("commit")}</dt><dd><code>{target.commitOid ?? t("no.new.commit")}</code></dd></div>
        <div><dt>{t("local")}</dt><dd>{proof.localBranch ?? t("detached.head")} · <code>{shortOid(proof.localHeadBefore)}</code> → <code>{shortOid(proof.localHeadAfter)}</code></dd></div>
        <div><dt>{t("files.2")}</dt><dd>{t("count.files", { count: proof.changedFiles.length })}</dd></div>
        <div><dt>{t("validation")}</dt><dd>{validationLabel(proof.validationStatus, t)}{proof.validationSummary ? ` · ${proof.validationSummary}` : ''}</dd></div>
        <div><dt>{t("local.history")}</dt><dd>{proof.commitInLocalHistory === true ? t("commit.is.still.in.local.history") : proof.commitInLocalHistory === false ? t("commit.is.no.longer.in.current.local.history") : t("cannot.confirm.at.this.time")}</dd></div>
      </dl>
    </section>
  )
}
