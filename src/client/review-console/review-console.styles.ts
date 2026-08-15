export const REVIEW_CONSOLE_STYLES = String.raw`
.dsh-wt-review-panel {
  display: grid;
  gap: 0;
  min-width: 0;
}
.dsh-wt-review-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wt-line);
}
.dsh-wt-review-kicker {
  margin-bottom: 3px;
  color: var(--wt-green);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.dsh-wt-review-title {
  margin: 0;
  min-width: 0;
  font-size: 16px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.dsh-wt-review-identity {
  flex: 0 1 auto;
  max-width: 46%;
  color: var(--wt-muted);
  font-size: 11px;
  text-align: right;
  overflow-wrap: anywhere;
}
.dsh-wt-review-section {
  min-width: 0;
  padding: 13px 16px;
  border-bottom: 1px solid var(--wt-line);
}
.dsh-wt-review-section:last-child { border-bottom: 0; }
.dsh-wt-review-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dsh-wt-review-heading {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .02em;
}
.dsh-wt-review-section-head > .dsh-wt-review-heading { margin-bottom: 0; }
.dsh-wt-review-section p { margin: 7px 0 0; }
.dsh-wt-test-command { display: grid; gap: 2px; min-width: 0; }
.dsh-wt-test-summary { color: var(--wt-muted); overflow-wrap: anywhere; }
.dsh-wt-review-file-list {
  display: grid;
  gap: 4px;
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.dsh-wt-review-file {
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid var(--wt-line);
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 2%, transparent);
  overflow-wrap: anywhere;
  word-break: break-word;
}
.dsh-wt-review-details {
  max-height: 360px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--wt-line);
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-wt-warning {
  color: var(--wt-amber);
  font-weight: 650;
  overflow-wrap: anywhere;
}
.dsh-wt-diff { min-width: 0; margin-top: 10px; }
.dsh-wt-diff-layout {
  display: grid;
  grid-template-columns: minmax(180px, .34fr) minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--wt-line);
  border-radius: 9px;
}
.dsh-wt-diff-files {
  min-width: 0;
  max-height: 520px;
  overflow: auto;
  border-right: 1px solid var(--wt-line);
  background: color-mix(in srgb, currentColor 2%, transparent);
}
.dsh-wt-diff-file {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 7px;
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 0;
  border-bottom: 1px solid var(--wt-line);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-wt-diff-file:hover,
.dsh-wt-diff-file[aria-pressed="true"] { background: color-mix(in srgb, currentColor 7%, transparent); }
.dsh-wt-diff-file:focus-visible,
.dsh-wt-diff-patch:focus-visible { outline: 2px solid #5a8dee; outline-offset: -2px; }
.dsh-wt-diff-status {
  display: inline-flex;
  min-width: 58px;
  justify-content: center;
  padding: 2px 5px;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.dsh-wt-diff-file[data-status="added"] .dsh-wt-diff-status { color: var(--wt-green); }
.dsh-wt-diff-file[data-status="deleted"] .dsh-wt-diff-status,
.dsh-wt-diff-file[data-status="binary"] .dsh-wt-diff-status { color: var(--wt-red); }
.dsh-wt-diff-file[data-status="renamed"] .dsh-wt-diff-status { color: var(--wt-amber); }
.dsh-wt-diff-path { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.dsh-wt-diff-truncated { color: var(--wt-amber); font-size: 10px; font-weight: 700; }
.dsh-wt-diff-view { min-width: 0; max-height: 520px; overflow: auto; background: color-mix(in srgb, currentColor 3%, transparent); }
.dsh-wt-diff-patch-wrap { min-width: 0; }
.dsh-wt-diff-patch {
  min-width: max-content;
  max-width: none;
  margin: 0;
  padding: 12px;
  color: inherit;
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 2;
}
.dsh-wt-diff-empty { padding: 12px; color: var(--wt-muted); }
.dsh-wt-danger { color: var(--wt-red); border-color: color-mix(in srgb, var(--wt-red) 45%, transparent); }
.dsh-wt-confirm {
  display: grid;
  gap: 9px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--wt-red) 45%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--wt-red) 6%, transparent);
}
.dsh-wt-confirm p { margin: 0; line-height: 1.5; }
.dsh-wt-action-status { min-height: 1.35em; margin-top: 8px; color: var(--wt-muted); }
.dsh-wt-retained-summary { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 10px; }
@media (max-width: 700px) {
  .dsh-wt-review-header { flex-direction: column; }
  .dsh-wt-review-identity { max-width: 100%; text-align: left; }
  .dsh-wt-diff-layout { grid-template-columns: 1fr; }
  .dsh-wt-diff-files { max-height: 230px; border-right: 0; border-bottom: 1px solid var(--wt-line); }
  .dsh-wt-diff-view { max-height: 420px; }
}
`
