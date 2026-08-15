# Porting notes: Domi Session Target → DeepSeek Harness

`dsh-git-worktree` reuses Domi's session-checkout domain and Git delivery engine, but Host identity cannot be copied mechanically. In Harness, a Session's persisted header cwd and Workspace attachment are the authority; a plugin registry is only supporting state.

## Preserved core

- Managed checkout registry and revision CAS
- Git common-dir / git-dir / canonical-path identity checks
- Local and Isolated fingerprints including staged, unstaged, untracked, binary, and deletion states
- Conflict-aware three-way planning and stale guards
- Task-only Finish that preserves unrelated Local index and working-tree layers
- Journal-based recovery, internal refs, conservative cleanup, quarantine, retention expiry, and Windows retry behavior

The apply engine remains tested independently even though direct Apply is not exposed in the current product flow.

## Harness adaptation

### Authoritative Session Target

`worktree_create` receives a Local source Session and preallocates a different target Session ID. It creates the Worktree and records the target binding, but does **not** mutate the source Session.

The Create ToolView then performs:

```text
workspaces.create({ path: managedRoot })
→ sessions.create({ workspaceId, sessionId: targetSessionId })
→ sessions.open(targetSessionId)
```

When that target Session invokes the plugin, its current Workspace may have a different Workspace ID from the original Local Workspace. The module accepts it only if the Workspace root canonicalizes to the recorded `managedRoot`; otherwise it raises `project_mismatch`.

### Worktree location

Domi's non-polluting policy is restored:

1. preferred: `<local-repo-parent>/<repo>-worktrees/<readable-unique-name>`;
2. fallback after a clean creation failure: `<plugin-state>/<repository-key>/<readable-unique-name>`.

Both locations are outside the Local checkout. Directory names include the reserved Session identity, iteration, and checkout identity, so parallel targets do not collide. The target path becomes its own registered Harness Workspace, so the new Session's `workspace-write` boundary is correct without nesting the Worktree in Local.

### Human acceptance instead of direct Apply

Domi's Electron product has a reversible Local Preview / Finalize / Rollback layer. Harness does not currently expose an equivalent transaction. The old plugin flow wrote directly to Local on `worktree_apply`, advanced `applyBaseOid`, and could then make Finish return a zero delta while Local remained modified.

The public flow is therefore intentionally narrower:

```text
Working → Ready for Review → user /worktree finalize → task-only commit → cleanup or retention
```

- `worktree_apply` is not registered as a model tool or command.
- Finish/Discard/Remove are not model tools.
- The Review ToolView submits a user command carrying the exact `reviewId` and registry revision shown by that card.
- Strict Finish rechecks the reviewed isolated fingerprint/head before any Local write; stale cards or post-review edits return `stale_target`/`stale_isolated` and require a new Ready snapshot.
- Historical records containing `applyBaseOid` fail closed for automatic Finish/Discard and tell the user to inspect Local.

### Caller scope

Global registry data is not a capability. Model and command lists filter by the original project and by `ownerSessionId === caller` or `sourceSessionId === caller`. Management validates the caller first; only then may the internal state machine act on the stored owner binding.

### Runtime context

A replay-stable dynamic context reports only the current registry state:

- Local with no target;
- Local handoff pending (stop modifications and open the target card);
- Isolated Working (authoritative cwd and Local boundary);
- Ready for Review (model stops; user accepts);
- Recovery required.

Git/filesystem validation still runs at operation boundaries; prompt context is guidance, not authorization.

## Client bundle

The package exports `./client` and declares `dsh.client`. The browser closure registers keyed `tool.call.toolview` rows for:

- `worktree_create`: path/checkout facts and an idempotent **Open isolated session** action;
- `worktree_ready_for_review`: summary, files, tests, commit message, and explicit cleanup/retention actions.

The ToolViews derive display state from durable logged call/result slices. They do not reconstruct checkout authority from UI state.

## Deliberately deferred

| Domi capability | Current status |
| --- | --- |
| Reversible Local Preview / Finalize / Rollback | Deferred; direct Apply disabled |
| Global Worktree Manager sheet | Deferred until a stable Host Remote/Projection management seam is added |
| Electron reveal/close-session choreography | Replaced only by Web Workspace/Session navigation; immediate cleanup makes the isolated Session terminal |
| Collaborator release/handoff UI | Partial domain remnants only; no complete Host lifecycle integration |
| Dependency snapshot/restore | Deferred |
| Audit timing pipeline | Deferred |
| Workflow `agent({ isolation })` | Blocked by Harness's deferred workflow isolation option |

Subagents inherit their parent's persisted cwd. They are therefore isolated when spawned from the real target Session, but this plugin does not add a separate per-child Worktree policy.

## Verification map

- `tests/session-checkout-module.test.ts`: real Worktree creation, unique target reservations, source/target identity, caller scope, runtime context, recovery, and legacy Apply fail-closed.
- `tests/session-checkout-apply.test.ts`: real Git merge/Finish/fingerprint behavior.
- `tests/client-toolview.test.tsx`: exact Session handoff and explicit user finalize actions.
- `scripts/check-publish.mjs`: every package export, Host patch, Host metadata, `dsh.client`, and executable browser ModuleLoader closure.
