export const TARGET_CONSOLE_STYLES = String.raw`
.dsh-wtc-target-chip {
  --wtc-state: #728096;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 2px 9px;
  border: 1px solid color-mix(in srgb, var(--wtc-state) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--wtc-state) 9%, transparent);
  color: inherit;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-wtc-target-chip:hover { background: color-mix(in srgb, var(--wtc-state) 15%, transparent); }
.dsh-wtc-target-chip:focus-visible { outline: 2px solid #5b8fe8; outline-offset: 2px; }
.dsh-wtc-target-chevron {
  width: 6px;
  height: 6px;
  margin: -3px 1px 0 2px;
  flex: 0 0 auto;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  opacity: .58;
  transform: rotate(45deg);
}
.dsh-wtc-menu-summary { display: grid; gap: 3px; min-width: 250px; text-align: left; white-space: normal; }
.dsh-wtc-menu-summary strong { font-size: 12px; color: inherit; }
.dsh-wtc-menu-summary span { color: color-mix(in srgb, currentColor 64%, transparent); font-size: 11px; line-height: 1.35; }
.dsh-wtc-menu-summary .dsh-wtc-menu-error { color: #c44747; }
.dsh-wtc-target-dot, .dsh-wtc-state-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--wtc-state);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wtc-state) 15%, transparent);
}
.dsh-wtc-target-chip[data-target-state="creating"] { --wtc-state: #c47a1c; }
.dsh-wtc-target-chip[data-target-state="working"] { --wtc-state: #2676dc; }
.dsh-wtc-target-chip[data-target-state="ready_for_review"] { --wtc-state: #25885d; }
.dsh-wtc-target-chip[data-target-state="retained"] { --wtc-state: #6b5bd2; }
.dsh-wtc-target-chip[data-target-state="cleanup_pending"] { --wtc-state: #c47a1c; }
.dsh-wtc-target-chip[data-target-state="recovery_required"],
.dsh-wtc-target-chip[data-target-state="error"] { --wtc-state: #c94747; }
.dsh-wtc-target-chip[data-target-state="delivered"] { opacity: .66; }
.dsh-wtc-target-expiry { color: color-mix(in srgb, currentColor 62%, transparent); font-weight: 520; }

.dsh-wtc-console {
  --wtc-ink: color-mix(in srgb, currentColor 94%, transparent);
  --wtc-muted: color-mix(in srgb, currentColor 58%, transparent);
  --wtc-line: color-mix(in srgb, currentColor 14%, transparent);
  --wtc-panel: color-mix(in srgb, currentColor 4%, transparent);
  --wtc-blue: #2f6fd0;
  --wtc-red: #c44747;
  position: relative;
  display: grid;
  gap: 14px;
  min-width: 0;
  width: 100%;
  padding: 18px clamp(12px, 3vw, 26px) 28px;
  color: var(--wtc-ink);
  box-sizing: border-box;
}
.dsh-wtc-console h2, .dsh-wtc-console h3 { margin: 0; letter-spacing: -.025em; }
.dsh-wtc-console h2 { font-size: clamp(20px, 3vw, 28px); font-weight: 720; }
.dsh-wtc-console h3 { font-size: 15px; font-weight: 680; }
.dsh-wtc-console-head, .dsh-wtc-section-head, .dsh-wtc-current,
.dsh-wtc-row, .dsh-wtc-row-title, .dsh-wtc-row-actions, .dsh-wtc-current-actions {
  display: flex;
  align-items: center;
}
.dsh-wtc-console-head, .dsh-wtc-section-head, .dsh-wtc-current, .dsh-wtc-row { justify-content: space-between; }
.dsh-wtc-console-head { gap: 16px; }
.dsh-wtc-kicker, .dsh-wtc-label {
  display: block;
  color: var(--wtc-muted);
  font-size: 10px;
  font-weight: 720;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.dsh-wtc-kicker { margin-bottom: 3px; }
.dsh-wtc-current, .dsh-wtc-list-section {
  min-width: 0;
  border: 1px solid var(--wtc-line);
  border-radius: 14px;
  background: linear-gradient(145deg, color-mix(in srgb, currentColor 3%, transparent), transparent 52%);
}
.dsh-wtc-current { gap: 16px; padding: 14px 16px; }
.dsh-wtc-current > div:first-child { min-width: 0; display: grid; gap: 3px; }
.dsh-wtc-current strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-wtc-current-actions, .dsh-wtc-row-actions { gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
.dsh-wtc-list-section { overflow: hidden; }
.dsh-wtc-section-head { padding: 12px 14px; border-bottom: 1px solid var(--wtc-line); }
.dsh-wtc-count { min-width: 26px; padding: 3px 7px; border-radius: 999px; background: var(--wtc-panel); color: var(--wtc-muted); text-align: center; font-size: 11px; }
.dsh-wtc-list { list-style: none; margin: 0; padding: 0; }
.dsh-wtc-row { position: relative; gap: 14px; min-width: 0; padding: 12px 14px; border-bottom: 1px solid var(--wtc-line); }
.dsh-wtc-row:last-child { border-bottom: 0; }
.dsh-wtc-row[data-current-target="true"] { background: color-mix(in srgb, var(--wtc-blue) 6%, transparent); }
.dsh-wtc-row-main { min-width: 0; display: grid; gap: 6px; }
.dsh-wtc-row-title { min-width: 0; gap: 10px; }
.dsh-wtc-row-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsh-wtc-relation { flex: 0 0 auto; padding: 2px 6px; border-radius: 999px; background: var(--wtc-panel); color: var(--wtc-muted); font-size: 10px; font-weight: 650; }
.dsh-wtc-state { --wtc-state: #728096; display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; font-size: 12px; font-weight: 680; }
.dsh-wtc-state[data-target-state="creating"], .dsh-wtc-state[data-target-state="cleanup_pending"] { --wtc-state: #c47a1c; }
.dsh-wtc-state[data-target-state="working"] { --wtc-state: #2676dc; }
.dsh-wtc-state[data-target-state="ready_for_review"] { --wtc-state: #25885d; }
.dsh-wtc-state[data-target-state="retained"] { --wtc-state: #6b5bd2; }
.dsh-wtc-state[data-target-state="recovery_required"] { --wtc-state: #c94747; }
.dsh-wtc-state[data-target-state="delivered"] { opacity: .66; }
.dsh-wtc-facts { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--wtc-muted); font-size: 11px; }
.dsh-wtc-recovery-message { color: var(--wtc-red); font-weight: 620; }
.dsh-wtc-revision { color: var(--wtc-muted); font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsh-wtc-button {
  min-height: 30px;
  border: 1px solid var(--wtc-line);
  border-radius: 8px;
  padding: 5px 9px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.dsh-wtc-button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 7%, transparent); border-color: color-mix(in srgb, currentColor 30%, transparent); }
.dsh-wtc-button:focus-visible { outline: 2px solid #5b8fe8; outline-offset: 2px; }
.dsh-wtc-button:disabled { opacity: .5; cursor: wait; }
.dsh-wtc-primary { color: white; border-color: var(--wtc-blue); background: var(--wtc-blue); }
.dsh-wtc-danger { color: var(--wtc-red); }
.dsh-wtc-empty, .dsh-wtc-loading { padding: 24px 14px; color: var(--wtc-muted); text-align: center; }
.dsh-wtc-error { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--wtc-red) 35%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--wtc-red) 8%, transparent); color: var(--wtc-red); overflow-wrap: anywhere; }
.dsh-wtc-confirm { position: absolute; z-index: 2; inset: 12px; align-self: start; display: grid; gap: 10px; max-width: 520px; margin: 64px auto 0; padding: 18px; border: 1px solid color-mix(in srgb, var(--wtc-red) 35%, var(--wtc-line)); border-radius: 14px; background: Canvas; color: CanvasText; box-shadow: 0 20px 60px rgba(0,0,0,.24); }
.dsh-wtc-confirm p { margin: 0; color: color-mix(in srgb, currentColor 68%, transparent); line-height: 1.5; }
.dsh-wtc-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.dsh-wtc-manager-dialog { width: min(960px, calc(100vw - 32px)); max-width: 960px; max-height: min(86vh, 900px); }
.dsh-wtc-manager-content { overflow: auto; min-height: 0; }
.dsh-wtc-manager-content .dsh-wtc-console { padding: 4px 0 8px; }
@media (max-width: 620px) {
  .dsh-wtc-current, .dsh-wtc-row { align-items: flex-start; flex-direction: column; }
  .dsh-wtc-current-actions, .dsh-wtc-row-actions { width: 100%; justify-content: flex-start; }
}
`
