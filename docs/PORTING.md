# Porting notes

dsh-git-worktree's session-checkout domain is ported from [Domi](https://github.com/wloops/domi)'s production worktree system, which runs in Domi's Electron app on thousands of real tasks. The port is a **cut, not a rewrite**: the state machine (`session-checkout-module.ts`), apply engine (`session-checkout-apply.ts`), ports (`ports.ts`), and the Domi test suites were carried over and adapted.

## What was removed (Domi-specific surface)

| Removed | Why |
| --- | --- |
| Local Preview (`preview` / `rollback_preview` / `finalize_preview` + `preview_active`/`preview_detached` states, `PreviewReceipt`) | Depends on Domi's dual-checkout model and Electron UI; DSH has no equivalent |
| Collaborator delegation (`release_collaborator*`, `collaborator_active`, delegation fields) | Waits on DSH's subagent child-cwd seam (upstream rc.6+) |
| Handoff (`bindVerifiedIsolated`, `forkAgentSession`) | Same seam dependency |
| Session lease (`lease`, `CheckoutLease`) | DSH's sandbox derives the workspace root from the session cwd natively |
| Electron reveal IPC (`resolveManagedRootForReveal`) | No file-manager reveal in DSH |
| Audit timing (`onTimingEvent`) | No audit pipeline in the plugin scope |

## What was changed

| Change | Detail |
| --- | --- |
| `apply` semantics | Domi's `apply` wrote Local through the preview engine (reversible). Here it calls `applyEngine.apply` directly: plan → verify → patch Local → stays `ready_for_review` (irreversible, but `finish` and `discard` close the loop) |
| `finish` semantics | Calls `applyEngine.finish` directly instead of preview → finalize; same task-delta commit with user staged/working preservation |
| Journal operations | `apply` replaced the shared `preview` journal; `reconcile` recovers `planning`-step `apply`/`finish` journals to `ready` (proven Local untouched) and everything else to `recovery_required` |
| Worktree location | **Inside the repo** at `<repo>/.dsh-worktrees/` — DSH's `workspace-write` sandbox grants only the session workspace root, so Domi's outside-repo layout (sibling container / data dir) cannot work here |
| Git runner | Port adapters use `ctx.subprocess` (tree-scoped termination); the apply engine keeps its own hardened `runGit` (trusted plugin code, testable against real git in temp repos) |
| Internal refs | `refs/dsh-worktree/session-checkouts/<key>` (Domi used `refs/domi/...`) |
| Commit identity | Internal snapshot commits use `dsh-git-worktree Apply <dsh-worktree-apply@localhost>` |

## Test assets

- `tests/session-checkout-apply.test.ts` — ported from Domi (bun:test → vitest, Bun.spawn → spawnSync); **31 passed** against real git: conflict detection, fingerprint CAS, stale guards, monorepo boundary, binary files, Windows-style paths.
- `tests/session-checkout-module.test.ts` — ported state-machine suite (journal recovery, reconcile, cleanup) follows once the DSH tool surface settles.

## Upstream gaps this plugin waits on

- Subagent worktree isolation needs the provider-prepared child-cwd seam (upstream commit `0647d61abf`, tracked in [paradoxSCH/dsh-worktree](https://github.com/paradoxSCH/dsh-worktree)).
- Workflow `isolation: 'worktree'` needs the isolation-adapter seam (`runtime.ts` rejects it today).
