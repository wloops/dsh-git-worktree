import { REVIEW_CONSOLE_STYLES } from './review-console/review-console.styles.js'

export const WORKTREE_STYLES = String.raw`
/* Managed owner decoration inside the version/hash-gated official Workspace row. */
.dsh-git-worktree-sidebar-icon,
.dsh-git-worktree-sidebar-badge {
  flex: 0 0 auto;
}
.dsh-git-worktree-sidebar-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-state-business-primary);
}
.dsh-git-worktree-sidebar-badge {
  box-sizing: border-box;
  max-width: 76px;
  min-height: 20px;
  padding: 1px 6px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dsh-wt-sidebar-accent) 24%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsh-wt-sidebar-accent) 10%, transparent);
  color: var(--dsh-wt-sidebar-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-git-worktree-sidebar-icon,
.dsh-git-worktree-sidebar-badge[data-worktree-state="working"] {
  --dsh-wt-sidebar-accent: var(--dsw-alias-state-business-primary);
}
.dsh-git-worktree-sidebar-icon[data-worktree-state="ready_for_review"],
.dsh-git-worktree-sidebar-badge[data-worktree-state="ready_for_review"] {
  --dsh-wt-sidebar-accent: var(--dsw-alias-state-warn-label);
  color: var(--dsw-alias-state-warn-label);
}
.dsh-git-worktree-sidebar-icon[data-worktree-state="preview_active"],
.dsh-git-worktree-sidebar-badge[data-worktree-state="preview_active"] {
  --dsh-wt-sidebar-accent: color-mix(in srgb, var(--dsw-alias-state-business-primary) 68%, var(--dsw-alias-state-error-primary));
  color: var(--dsh-wt-sidebar-accent);
}
.dsh-git-worktree-sidebar-icon[data-worktree-state="preview_detached"],
.dsh-git-worktree-sidebar-badge[data-worktree-state="preview_detached"],
.dsh-git-worktree-sidebar-icon[data-worktree-state="recovery_required"],
.dsh-git-worktree-sidebar-badge[data-worktree-state="recovery_required"] {
  --dsh-wt-sidebar-accent: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
.dsh-git-worktree-sidebar-icon[data-worktree-state="finalized"],
.dsh-git-worktree-sidebar-badge[data-worktree-state="finalized"] {
  --dsh-wt-sidebar-accent: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-state-success-primary);
}
.dsh-git-worktree-sidebar-icon[data-worktree-state="discarded"],
.dsh-git-worktree-sidebar-badge[data-worktree-state="discarded"] {
  --dsh-wt-sidebar-accent: var(--dsw-alias-label-tertiary);
  color: var(--dsw-alias-label-tertiary);
}

.dsh-wt-card {
  --wt-ink: color-mix(in srgb, currentColor 92%, transparent);
  --wt-muted: color-mix(in srgb, currentColor 58%, transparent);
  --wt-line: color-mix(in srgb, currentColor 14%, transparent);
  --wt-panel: color-mix(in srgb, currentColor 4%, transparent);
  --wt-green: #2f8f64;
  --wt-amber: #b46a13;
  --wt-red: #bd3b3b;
  margin: 6px 0;
  border: 1px solid var(--wt-line);
  border-radius: 12px;
  background: linear-gradient(145deg, color-mix(in srgb, currentColor 2%, transparent), transparent 45%);
  color: var(--wt-ink);
  overflow: hidden;
  font-size: 13px;
}
.dsh-wt-card[data-tool="worktree_ready_for_review"] { overflow:visible; }
.dsh-wt-head { display:flex; align-items:center; gap:10px; padding:10px 12px; min-width:0; }
.dsh-wt-mark { width:9px; height:9px; flex:0 0 auto; border-radius:999px; background:var(--wt-green); box-shadow:0 0 0 4px color-mix(in srgb, var(--wt-green) 14%, transparent); }
.dsh-wt-card[data-state="running"] .dsh-wt-mark { background:var(--wt-amber); animation:dsh-wt-pulse 1.4s ease-in-out infinite; }
.dsh-wt-card[data-state="error"] .dsh-wt-mark { background:var(--wt-red); box-shadow:0 0 0 4px color-mix(in srgb, var(--wt-red) 14%, transparent); }
@keyframes dsh-wt-pulse { 50% { opacity:.35; transform:scale(.82); } }
@media (prefers-reduced-motion: reduce) { .dsh-wt-card[data-state="running"] .dsh-wt-mark { animation:none; } }
.dsh-wt-title { font-weight:650; letter-spacing:-.01em; white-space:nowrap; }
.dsh-wt-subtitle { color:var(--wt-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.dsh-wt-spacer { flex:1; }
.dsh-wt-body { border-top:1px solid var(--wt-line); padding:12px; display:grid; gap:11px; background:var(--wt-panel); }
.dsh-wt-grid { display:grid; grid-template-columns:minmax(90px, .35fr) minmax(0, 1fr); gap:7px 12px; }
.dsh-wt-label { color:var(--wt-muted); }
.dsh-wt-value { min-width:0; overflow-wrap:anywhere; }
.dsh-wt-code { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; }
.dsh-wt-path { border:0; padding:0; color:inherit; text-align:left; background:none; cursor:pointer; text-decoration:underline; text-decoration-color:color-mix(in srgb, currentColor 28%, transparent); text-underline-offset:3px; }
.dsh-wt-path:hover { text-decoration-color:currentColor; }
.dsh-wt-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.dsh-wt-button { border:1px solid var(--wt-line); border-radius:8px; padding:7px 11px; background:transparent; color:inherit; font:inherit; font-weight:600; cursor:pointer; transition:background .15s ease, border-color .15s ease, transform .15s ease; }
.dsh-wt-button:hover:not(:disabled) { background:color-mix(in srgb, currentColor 7%, transparent); border-color:color-mix(in srgb, currentColor 28%, transparent); }
.dsh-wt-button:active:not(:disabled) { transform:translateY(1px); }
.dsh-wt-button:focus-visible, .dsh-wt-path:focus-visible, .dsh-wt-summary:focus-visible { outline:2px solid #5a8dee; outline-offset:2px; }
.dsh-wt-button:disabled { opacity:.52; cursor:wait; }
.dsh-wt-primary { background:#2257d7; color:white; border-color:#2257d7; }
.dsh-wt-primary:hover:not(:disabled) { background:#1848bd; border-color:#1848bd; }
.dsh-wt-error { color:var(--wt-red); line-height:1.45; overflow-wrap:anywhere; }
.dsh-wt-status { color:var(--wt-muted); }
.dsh-wt-badge { display:inline-flex; align-items:center; border:1px solid var(--wt-line); border-radius:999px; padding:2px 7px; font-size:11px; font-weight:650; text-transform:uppercase; letter-spacing:.04em; }
.dsh-wt-badge[data-validation="passed"] { color:var(--wt-green); }
.dsh-wt-badge[data-validation="failed"] { color:var(--wt-red); }
.dsh-wt-badge[data-validation="partial"] { color:var(--wt-amber); }
.dsh-wt-files { display:flex; flex-wrap:wrap; gap:5px; }
.dsh-wt-file { border:1px solid var(--wt-line); border-radius:6px; padding:3px 6px; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-wt-commit { margin:0; padding:9px 10px; max-height:150px; overflow:auto; border:1px solid var(--wt-line); border-radius:8px; background:color-mix(in srgb, currentColor 3%, transparent); white-space:pre-wrap; overflow-wrap:anywhere; }
.dsh-wt-details { border-top:1px solid var(--wt-line); padding-top:9px; }
.dsh-wt-summary { cursor:pointer; color:var(--wt-muted); font-weight:600; }
.dsh-wt-test-list { list-style:none; padding:7px 0 0; margin:0; display:grid; gap:6px; }
.dsh-wt-test { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:7px; align-items:start; }
.dsh-wt-test-state { color:var(--wt-muted); font-size:11px; text-transform:uppercase; padding-top:2px; }
.dsh-wt-test-command { overflow-wrap:anywhere; }
.dsh-wt-retain { position:relative; }
.dsh-wt-retain[open] > .dsh-wt-summary { margin-bottom:7px; }
.dsh-wt-retain-actions { display:flex; gap:6px; flex-wrap:wrap; }
.dsh-wt-visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.dsh-wt-pre-session { position:relative; display:inline-flex; align-items:center; min-width:0; }
/* Match the Harness PermissionSelect toolbar trigger while retaining switch semantics. */
.dsh-wt-pre-session-toggle { display:inline-flex; align-items:center; gap:4px; min-width:0; height:28px; padding:0 8px; border:none; border-radius:24px; outline:none; background:transparent; color:var(--dsw-alias-label-secondary, inherit); font:inherit; font-size:13px; line-height:20px; font-weight:500; cursor:pointer; white-space:nowrap; }
.dsh-wt-pre-session-toggle:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 7%, transparent)); }
.dsh-wt-pre-session-toggle:focus-visible { box-shadow:0 0 0 2px var(--dsw-alias-border-l3, currentColor); }
.dsh-wt-pre-session-toggle:disabled { color:var(--dsw-alias-label-dimmed, inherit); cursor:default; }
.dsh-wt-pre-session-toggle[aria-checked="true"] { color:var(--dsw-alias-label-primary, inherit); }
.dsh-wt-pre-session-check { display:inline-flex; flex:0 0 auto; align-items:center; justify-content:center; box-sizing:border-box; width:14px; height:14px; border:1px solid currentColor; border-radius:3px; font-size:11px; line-height:1; }
.dsh-wt-pre-session-error { position:absolute; left:0; bottom:calc(100% + 7px); z-index:20; width:max-content; max-width:min(360px, 75vw); padding:7px 9px; border:1px solid color-mix(in srgb, #bd3b3b 35%, transparent); border-radius:8px; background:color-mix(in srgb, Canvas 96%, #bd3b3b 4%); color:#bd3b3b; font-size:11px; font-weight:500; line-height:1.4; white-space:normal; box-shadow:0 8px 24px color-mix(in srgb, black 14%, transparent); }

.dsh-wt-pre-session-note { margin:0; color:color-mix(in srgb, currentColor 62%, transparent); font-size:12px; line-height:1.5; }
@media (max-width: 560px) { .dsh-wt-grid { grid-template-columns:1fr; gap:3px; } .dsh-wt-label { margin-top:4px; } }
${REVIEW_CONSOLE_STYLES}

.dsh-wt-pre-session .dsh-wt-button,
.dsh-wt-create-dialog .dsh-wt-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; line-height:20px; box-sizing:border-box; }
.dsh-wt-create-dialog .dsh-wt-button .dsh-wt-icon { width:16px; height:16px; flex:0 0 16px; vertical-align:middle; }
.dsh-wt-pre-session-check .dsh-wt-icon { width:12px; height:12px; flex-basis:12px; }
`
