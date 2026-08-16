export const REVIEW_CONSOLE_STYLES = String.raw`
.dsh-wt-review-panel,
.dsh-wt-review-dock {
  --wt-ink: color-mix(in srgb, currentColor 92%, transparent);
  --wt-muted: color-mix(in srgb, currentColor 58%, transparent);
  --wt-line: color-mix(in srgb, currentColor 14%, transparent);
  --wt-panel: color-mix(in srgb, currentColor 4%, transparent);
  --wt-green: #2f8f64;
  --wt-amber: #b46a13;
  --wt-red: #bd3b3b;
}
.dsh-wt-review-panel { display:grid; min-width:0; }
.dsh-wt-review-compact-head { display:flex; align-items:flex-start; gap:10px; min-width:0; padding:12px 14px 8px; }
.dsh-wt-review-status-icon,
.dsh-wt-review-dock-icon { display:inline-grid; place-items:center; width:18px; height:18px; flex:0 0 auto; border-radius:999px; background:color-mix(in srgb, var(--wt-green) 14%, transparent); color:var(--wt-green); font-size:12px; font-weight:800; }
.dsh-wt-review-status-icon[data-validation="failed"],
.dsh-wt-review-status-icon[data-validation="partial"] { background:color-mix(in srgb, var(--wt-amber) 14%, transparent); color:var(--wt-amber); }
.dsh-wt-review-compact-copy { min-width:0; flex:1; }
.dsh-wt-review-title { margin:0; min-width:0; font-size:14px; line-height:1.35; overflow-wrap:anywhere; }
.dsh-wt-review-summary { margin:3px 0 0; color:var(--wt-muted); line-height:1.45; overflow-wrap:anywhere; }
.dsh-wt-review-identity { flex:0 1 auto; max-width:34%; color:var(--wt-muted); font-size:10px; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-wt-review-meta { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px; padding:0 14px 10px 42px; color:var(--wt-muted); font-size:11px; }
.dsh-wt-review-meta [data-validation="passed"] { color:var(--wt-green); }
.dsh-wt-review-meta [data-validation="failed"],
.dsh-wt-review-meta [data-validation="partial"] { color:var(--wt-amber); }
.dsh-wt-review-details-toggle { border:0; padding:0; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.dsh-wt-review-details-toggle:hover { color:var(--wt-ink); }
.dsh-wt-review-details-toggle:focus-visible,
.dsh-wt-more-trigger:focus-visible { outline:2px solid #5a8dee; outline-offset:2px; }
.dsh-wt-review-validation-details { margin:0 14px 10px 42px; padding:9px 10px; border-radius:8px; background:var(--wt-panel); font-size:11px; }
.dsh-wt-review-validation-details > p { margin:0 0 7px; }
.dsh-wt-test-list { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
.dsh-wt-test { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:7px; align-items:start; }
.dsh-wt-test-state { color:var(--wt-muted); font-size:10px; padding-top:2px; }
.dsh-wt-test-state[data-test-status="passed"] { color:var(--wt-green); }
.dsh-wt-test-state[data-test-status="failed"] { color:var(--wt-amber); }
.dsh-wt-test-command { display:grid; gap:2px; min-width:0; overflow-wrap:anywhere; }
.dsh-wt-test-summary { color:var(--wt-muted); overflow-wrap:anywhere; }
.dsh-wt-review-actions { padding:0 14px 12px 42px; }
.dsh-wt-more-menu { position:relative; }
.dsh-wt-more-trigger { display:grid; place-items:center; width:32px; height:30px; border:1px solid var(--wt-line); border-radius:8px; cursor:pointer; list-style:none; font-weight:800; letter-spacing:1px; }
.dsh-wt-more-trigger::-webkit-details-marker { display:none; }
.dsh-wt-more-content { position:absolute; right:0; bottom:calc(100% + 6px); z-index:40; min-width:150px; padding:4px; border:1px solid var(--wt-line); border-radius:9px; background:Canvas; box-shadow:0 10px 30px color-mix(in srgb, black 18%, transparent); }
.dsh-wt-more-item { width:100%; border:0; border-radius:6px; padding:7px 9px; background:transparent; color:inherit; text-align:left; font:inherit; cursor:pointer; }
.dsh-wt-more-item:hover:not(:disabled) { background:color-mix(in srgb, currentColor 7%, transparent); }
.dsh-wt-more-item:disabled { opacity:.5; cursor:not-allowed; }
.dsh-wt-danger { color:var(--wt-red); border-color:color-mix(in srgb, var(--wt-red) 45%, transparent); }
.dsh-wt-danger-text { color:var(--wt-red); }
.dsh-wt-modal-footer { display:flex; justify-content:flex-end; gap:8px; }
.dsh-wt-commit-dialog { display:grid; gap:8px; }
.dsh-wt-commit-dialog > label:first-child { font-size:12px; font-weight:700; }
.dsh-wt-commit-dialog textarea { min-height:132px; max-height:240px; resize:vertical; border:1px solid var(--wt-line); border-radius:8px; padding:9px 10px; background:transparent; color:inherit; font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsh-wt-character-count { color:var(--wt-muted); font-size:10px; text-align:right; }
.dsh-wt-retention-check { display:flex; align-items:center; gap:8px; border:1px solid var(--wt-line); border-radius:8px; padding:8px 9px; font-size:12px; }
.dsh-wt-retention-select { display:grid; gap:5px; padding:9px; border-radius:8px; background:var(--wt-panel); font-size:11px; }
.dsh-wt-retention-select select { min-height:32px; border:1px solid var(--wt-line); border-radius:7px; padding:0 8px; background:Canvas; color:inherit; }
.dsh-wt-preflight { margin-top:7px; padding:7px 9px; border-radius:8px; background:var(--wt-panel); color:var(--wt-muted); font-size:11px; }
.dsh-wt-preflight[data-preflight="conflict"],
.dsh-wt-preflight[data-preflight="blocked"] { color:var(--wt-amber); }
.dsh-wt-action-status { min-height:1.35em; margin-top:7px; color:var(--wt-muted); font-size:11px; }
.dsh-wt-review-dock { box-sizing:border-box; display:flex; flex:none; align-items:center; gap:9px; width:calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 2 * var(--dsh-composer-dock-inset, 0px)); max-width:calc(var(--dsh-composer-card-max-width, 780px) - 2 * var(--dsh-composer-dock-inset, 0px)); margin:0 auto 8px; padding:7px 9px; border:1px solid color-mix(in srgb, #3275db 22%, transparent); border-radius:9px; background:color-mix(in srgb, #3275db 6%, transparent); color:var(--wt-ink); font-size:12px; }
.dsh-wt-review-dock-copy { display:grid; min-width:0; flex:1; gap:1px; }
.dsh-wt-review-dock-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-wt-review-dock-copy span { color:var(--wt-muted); font-size:10px; }
.dsh-wt-review-dock .dsh-wt-review-actions { padding:0; }
.dsh-wt-review-dock .dsh-wt-action-status { display:none; }
.dsh-wt-review-dock .dsh-wt-button { padding:5px 9px; font-size:11px; }
.dsh-wt-review-dock .dsh-wt-more-trigger { width:29px; height:27px; }
@media (max-width: 620px) {
  .dsh-wt-review-compact-head { flex-wrap:wrap; }
  .dsh-wt-review-identity { max-width:100%; margin-left:28px; }
  .dsh-wt-review-meta,
  .dsh-wt-review-validation-details,
  .dsh-wt-review-actions { margin-left:0; padding-left:14px; }
  .dsh-wt-review-dock { flex-wrap:wrap; width:calc(100% - 2 * var(--dsh-composer-side-clearance, 12px) - 2 * var(--dsh-composer-dock-inset, 0px)); }
  .dsh-wt-review-dock-copy { flex-basis:calc(100% - 28px); }
  .dsh-wt-review-dock-copy span { display:none; }
  .dsh-wt-review-dock .dsh-wt-review-actions { margin-left:auto; }
}
`
