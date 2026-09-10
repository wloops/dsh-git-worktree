export const REVIEW_CONSOLE_STYLES = String.raw`
.dsh-wt-review-panel,
.dsh-wt-details-modal,
.dsh-wt-review-dock {
  --wt-ink: color-mix(in srgb, currentColor 92%, transparent);
  --wt-muted: color-mix(in srgb, currentColor 68%, transparent);
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
.dsh-wt-review-identity { display:block; flex:0 1 auto; max-width:100%; color:var(--wt-muted); font-size:12px; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-wt-review-meta { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px; padding:0 14px 10px 42px; color:var(--wt-muted); font-size:12px; }
.dsh-wt-review-meta [data-validation="passed"] { color:var(--wt-green); }
.dsh-wt-review-meta [data-validation="failed"],
.dsh-wt-review-meta [data-validation="partial"] { color:var(--wt-amber); }
.dsh-wt-review-details-toggle { border:0; padding:0; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.dsh-wt-review-details-toggle:hover { color:var(--wt-ink); }
.dsh-wt-review-details-toggle:focus-visible,
.dsh-wt-more-trigger:focus-visible,
.dsh-wt-review-dock button:focus-visible { outline:2px solid #5a8dee; outline-offset:2px; }
.dsh-wt-review-validation-details { margin:0 14px 10px 42px; padding:9px 10px; border-radius:8px; background:var(--wt-panel); font-size:12px; }
.dsh-wt-review-validation-details > p { margin:0 0 7px; }
.dsh-wt-test-list { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
.dsh-wt-test { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:7px; align-items:start; }
.dsh-wt-test-state { color:var(--wt-muted); font-size:12px; padding-top:2px; }
.dsh-wt-test-state[data-test-status="passed"] { color:var(--wt-green); }
.dsh-wt-test-state[data-test-status="failed"] { color:var(--wt-amber); }
.dsh-wt-test-command { display:grid; gap:2px; min-width:0; overflow-wrap:anywhere; }
.dsh-wt-test-summary { color:var(--wt-muted); overflow-wrap:anywhere; }
.dsh-wt-review-actions { padding:0 14px 12px 42px; }
.dsh-wt-more-menu { position:relative; }
.dsh-wt-more-trigger { display:grid; place-items:center; width:32px; height:30px; border:1px solid var(--wt-line); border-radius:8px; cursor:pointer; list-style:none; font-weight:800; letter-spacing:1px; }
.dsh-wt-more-trigger::-webkit-details-marker { display:none; }
.dsh-wt-more-content { position:absolute; right:0; top:calc(100% + 6px); bottom:auto; z-index:40; min-width:150px; padding:4px; border:1px solid var(--wt-line); border-radius:9px; background:Canvas; box-shadow:0 10px 30px color-mix(in srgb, black 18%, transparent); }
.dsh-wt-review-dock .dsh-wt-more-content { top:auto; bottom:calc(100% + 6px); }
.dsh-wt-more-item { width:100%; border:0; border-radius:6px; padding:7px 9px; background:transparent; color:inherit; text-align:left; font:inherit; cursor:pointer; }
.dsh-wt-more-item:hover:not(:disabled) { background:color-mix(in srgb, currentColor 7%, transparent); }
.dsh-wt-more-item:disabled { opacity:.5; cursor:not-allowed; }
.dsh-wt-danger { color:var(--wt-red); border-color:color-mix(in srgb, var(--wt-red) 45%, transparent); }
.dsh-wt-danger-text { color:var(--wt-red); }
.dsh-wt-modal-footer { display:flex; justify-content:flex-end; gap:8px; }
.dsh-wt-commit-dialog { display:grid; gap:8px; }
.dsh-wt-commit-dialog > label:first-child { font-size:12px; font-weight:700; }
.dsh-wt-commit-dialog textarea { min-height:132px; max-height:240px; resize:vertical; border:1px solid var(--wt-line); border-radius:8px; padding:9px 10px; background:transparent; color:inherit; font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsh-wt-character-count { color:var(--wt-muted); font-size:12px; text-align:left; }
.dsh-wt-checkpoint-note { display:grid; gap:3px; padding:9px 10px; border:1px solid color-mix(in srgb, #3275db 24%, transparent); border-radius:8px; background:color-mix(in srgb, #3275db 6%, transparent); font-size:12px; }
.dsh-wt-checkpoint-note span,
.dsh-wt-checkpoint-summary { color:var(--wt-muted); }
.dsh-wt-retention-check { display:flex; align-items:center; gap:8px; border:1px solid var(--wt-line); border-radius:8px; padding:8px 9px; font-size:12px; }
.dsh-wt-retention-select { display:grid; gap:5px; padding:9px; border-radius:8px; background:var(--wt-panel); font-size:12px; }
.dsh-wt-retention-select select { min-height:32px; border:1px solid var(--wt-line); border-radius:7px; padding:0 8px; background:Canvas; color:inherit; }
.dsh-wt-preflight { display:grid; gap:7px; margin-top:7px; padding:8px 9px; border-radius:8px; background:var(--wt-panel); color:var(--wt-muted); font-size:12px; }
.dsh-wt-preflight[data-preflight="conflict"],
.dsh-wt-preflight[data-preflight="blocked"],
.dsh-wt-preflight[data-preflight="error"] { color:var(--wt-amber); }
.dsh-wt-preflight-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dsh-wt-preflight-head strong { color:var(--wt-ink); }
.dsh-wt-preflight-facts,
.dsh-wt-delivery-proof dl { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px 12px; margin:0; }
.dsh-wt-preflight-facts > div,
.dsh-wt-delivery-proof dl > div { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:5px; min-width:0; }
.dsh-wt-preflight-facts dt,
.dsh-wt-delivery-proof dt { color:var(--wt-muted); }
.dsh-wt-preflight-facts dd,
.dsh-wt-delivery-proof dd { min-width:0; margin:0; overflow-wrap:anywhere; }
.dsh-wt-conflict-list { display:grid; gap:3px; max-height:116px; margin:0; padding-left:18px; overflow:auto; }
.dsh-wt-recovery-actions { display:flex; flex-wrap:wrap; gap:6px; }
.dsh-wt-inline-action { border:0; padding:0; background:transparent; color:inherit; font:inherit; text-decoration:underline; cursor:pointer; }
.dsh-wt-inline-action:disabled { opacity:.5; cursor:not-allowed; }
.dsh-wt-delivery-proof { display:grid; gap:7px; margin-top:8px; padding:8px 9px; border:1px solid color-mix(in srgb, var(--wt-green) 26%, transparent); border-radius:8px; background:color-mix(in srgb, var(--wt-green) 6%, transparent); font-size:12px; }
.dsh-wt-delivery-proof header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dsh-wt-delivery-proof header span { color:var(--wt-muted); }
.dsh-wt-delivery-proof-compact { display:block; margin:1px 0 0; padding:0; border:0; background:transparent; color:var(--wt-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-wt-action-status { min-height:1.35em; margin-top:7px; color:var(--wt-muted); font-size:12px; }
.dsh-wt-review-dock { box-sizing:border-box; display:flex; flex:none; align-items:center; gap:9px; width:calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 2 * var(--dsh-composer-dock-inset, 0px)); max-width:calc(var(--dsh-composer-card-max-width, 780px) - 2 * var(--dsh-composer-dock-inset, 0px)); margin:0 auto 8px; padding:7px 9px; border:1px solid color-mix(in srgb, #3275db 22%, transparent); border-radius:9px; background:color-mix(in srgb, #3275db 6%, transparent); color:var(--wt-ink); font-size:12px; }
.dsh-wt-review-dock > .dsh-wt-icon { order:-2; }
.dsh-wt-review-dock-copy { order:-1; order:-1; display:grid; min-width:0; flex:1; gap:1px; }
.dsh-wt-review-dock-copy strong { font-weight:500; overflow-wrap:anywhere; }
.dsh-wt-review-dock-copy span { color:var(--wt-muted); font-size:12px; }
.dsh-wt-review-dock .dsh-wt-review-actions { min-width:0; max-width:100%; padding:0; }
.dsh-wt-action-status:empty { min-height:0; margin-top:0; }
.dsh-wt-action-status:empty { min-height:0; margin-top:0; }
.dsh-wt-review-dock .dsh-wt-action-status:empty { display:none; }
.dsh-wt-review-evidence-status { margin:0 14px 10px 42px; color:var(--wt-muted); font-size:12px; }
.dsh-wt-review-dock .dsh-wt-actions { justify-content:flex-end; }
.dsh-wt-review-dock .dsh-wt-preflight-facts { display:none; }
.dsh-wt-review-dock .dsh-wt-preflight { margin:0; padding:4px 6px; }
.dsh-wt-review-dock .dsh-wt-preflight[data-preflight="loading"],
.dsh-wt-review-dock .dsh-wt-preflight[data-preflight="ready"],
.dsh-wt-review-dock .dsh-wt-preflight[data-preflight="local_advanced"],
.dsh-wt-review-dock .dsh-wt-preflight[data-preflight="already_in_local"] { display:none; }
.dsh-wt-review-dock .dsh-wt-preflight-head > span { display:none; }
.dsh-wt-review-dock .dsh-wt-button { padding:5px 9px; font-size:12px; }
.dsh-wt-review-dock .dsh-wt-more-trigger { width:29px; height:27px; }
@media (max-width: 620px) {
  .dsh-wt-review-compact-head { flex-wrap:wrap; }
  .dsh-wt-review-identity { max-width:100%; margin-left:28px; }
  .dsh-wt-review-meta,
  .dsh-wt-review-validation-details,
  .dsh-wt-review-actions { margin-left:0; padding-left:14px; }
  .dsh-wt-review-dock { flex-wrap:wrap; width:calc(100% - 2 * var(--dsh-composer-side-clearance, 12px) - 2 * var(--dsh-composer-dock-inset, 0px)); }
  .dsh-wt-review-dock > .dsh-wt-icon { order:-2; }
.dsh-wt-review-dock-copy { order:-1; order:-1; flex-basis:calc(100% - 28px); }

  .dsh-wt-review-dock .dsh-wt-review-actions { margin-left:auto; }
}

.dsh-wt-icon { display:inline-flex; width:18px; height:18px; flex:0 0 18px; vertical-align:middle; }
.dsh-wt-review-dock { background:var(--dsw-alias-bg-layer-2, #fff); border-color:var(--wt-line); padding:10px 12px; gap:10px; }
.dsh-wt-review-dock-copy strong { font-size:13px; font-weight:550; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-wt-review-dock-copy .dsh-wt-dock-evidence { display:flex; align-items:center; gap:5px; }
.dsh-wt-dock-evidence .dsh-wt-icon { width:14px; height:14px; flex-basis:14px; }
.dsh-wt-details-trigger { display:inline-flex; align-items:center; gap:5px; flex-shrink:0; padding:6px; border:0; background:transparent; color:inherit; font:inherit; cursor:pointer; border-radius:6px; }
.dsh-wt-details-trigger:hover { background:var(--wt-panel); }
.dsh-wt-details-modal { width:min(720px, calc(100vw - 32px)); max-width:calc(100vw - 32px); max-height:calc(100dvh - 40px); border:1px solid var(--wt-line); border-radius:14px; }
.dsh-wt-details-body { padding:8px 24px 24px; overflow:auto; min-height:0; color:var(--wt-ink); font-size:13px; line-height:1.6; }
.dsh-wt-details-heading { display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.dsh-wt-details-heading h2 { font-size:20px; font-weight:600; line-height:1.4; margin:0; overflow-wrap:anywhere; flex:1; min-width:0; }
.dsh-wt-details-muted { color:var(--wt-muted); margin:6px 0 12px; white-space:pre-wrap; overflow-wrap:anywhere; }
.dsh-wt-details-badge { display:inline-flex; align-items:center; flex-shrink:0; border-radius:6px; padding:2px 8px; font-size:12px; background:var(--wt-panel); color:var(--wt-ink); }
.dsh-wt-details-badge[data-tone="warning"] { color:var(--wt-amber); background:color-mix(in srgb, var(--wt-amber) 9%, transparent); }
.dsh-wt-details-meta { display:flex; gap:20px; flex-wrap:wrap; margin:18px 0; color:var(--wt-muted); }
.dsh-wt-details-meta > span { display:inline-flex; align-items:center; gap:7px; }
.dsh-wt-details-notice { display:flex; align-items:flex-start; gap:9px; padding:12px; border-radius:8px; background:var(--wt-panel); }
.dsh-wt-details-notice[data-tone="warning"] { background:color-mix(in srgb, var(--wt-amber) 8%, transparent); }
.dsh-wt-details-section { border-top:1px solid var(--wt-line); padding:16px 0; }
.dsh-wt-details-section h3 { font-size:14px; font-weight:600; margin:0 0 12px; }
.dsh-wt-details-files, .dsh-wt-details-tests { padding:0; margin:0; list-style:none; }
.dsh-wt-details-files li { display:flex; align-items:flex-start; gap:10px; padding:8px 0; }
.dsh-wt-details-files li > span:nth-child(2) { flex:1; min-width:0; overflow-wrap:anywhere; font-family:ui-monospace, monospace; }
.dsh-wt-details-tests li { display:flex; gap:10px; padding:10px 0; }
.dsh-wt-details-tests li + li { border-top:1px solid var(--wt-line); }
.dsh-wt-details-tests li > div { flex:1; min-width:0; }
.dsh-wt-details-test-title { display:flex; justify-content:space-between; gap:12px; overflow-wrap:anywhere; }
.dsh-wt-details-test-title > span:last-child { flex-shrink:0; font-size:12px; }
.dsh-wt-details-tests p { color:var(--wt-muted); margin:4px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; }
.dsh-wt-details-modal [data-validation="passed"] { color:var(--wt-green); }
.dsh-wt-details-modal [data-validation="failed"] { color:var(--wt-red); }
.dsh-wt-details-modal [data-validation="partial"] { color:var(--wt-amber); }
.dsh-wt-details-version { border-top:1px solid var(--wt-line); padding-top:16px; color:var(--wt-muted); }
.dsh-wt-details-version summary { cursor:pointer; }
.dsh-wt-details-version summary:focus-visible { outline:2px solid #5a8dee; outline-offset:3px; }
.dsh-wt-details-version .dsh-wt-icon { margin:0 7px; }
.dsh-wt-details-version dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 14px; }
.dsh-wt-details-version dd { margin:0; overflow-wrap:anywhere; font-family:ui-monospace, monospace; }
@media (max-width:620px) {
 .dsh-wt-review-dock-copy strong { white-space:normal; }
 .dsh-wt-details-body { padding:8px 16px 16px; }
 .dsh-wt-details-test-title { flex-wrap:wrap; }
}


/* The host uses width:100% content columns; include padding in our owned layout. */
.dsh-wt-details-modal, .dsh-wt-details-modal *, .dsh-wt-details-modal *::before, .dsh-wt-details-modal *::after { box-sizing:border-box; }
.dsh-wt-details-modal { padding:0; gap:0; min-width:0; }
.dsh-wt-details-header { display:flex; align-items:center; justify-content:space-between; gap:16px; flex:none; padding:22px 24px 16px; min-width:0; }
.dsh-wt-details-header h1 { font-size:15px; font-weight:600; margin:0; min-width:0; overflow-wrap:anywhere; }
.dsh-wt-details-header button { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; flex:0 0 32px; border:0; border-radius:6px; background:transparent; color:inherit; cursor:pointer; }
.dsh-wt-details-header button:hover { background:var(--wt-panel); }
.dsh-wt-details-header button:focus-visible { outline:2px solid #5a8dee; outline-offset:2px; }
.dsh-wt-details-body { flex:1 1 auto; width:100%; min-width:0; scrollbar-gutter:stable; }
.dsh-wt-details-body > *, .dsh-wt-details-test-title > span:first-child { min-width:0; max-width:100%; overflow-wrap:anywhere; }
.dsh-wt-details-test-title > span:first-child { flex:1 1 auto; }
.dsh-wt-details-test-title > span:last-child { max-width:45%; white-space:normal; overflow-wrap:anywhere; }
.dsh-wt-details-version summary { display:flex; align-items:center; gap:6px; list-style:none; }
.dsh-wt-details-version summary::-webkit-details-marker { display:none; }
.dsh-wt-details-version[open] summary > .dsh-wt-icon:first-child { transform:rotate(90deg); }
.dsh-wt-review-actions .dsh-wt-button, .dsh-wt-review-actions .dsh-wt-more-item { display:inline-flex; align-items:center; gap:6px; }
.dsh-wt-review-actions .dsh-wt-icon { width:16px; height:16px; flex:0 0 16px; }
.dsh-wt-review-actions .dsh-wt-more-trigger { display:inline-flex; align-items:center; justify-content:center; }
@media(max-width:620px) { .dsh-wt-details-header { padding:16px; } }

`
