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

1. preferred: `<local-repo-parent>/<repo>--worktrees/<repo>--<checkout-short>--worktree>`;
2. fallback after an unsafe sibling or clean creation failure: `<plugin-state>/worktrees/<repository-key>/<repo>--<checkout-short>--worktree>`.

Both locations are outside the Local checkout. The Host derives the repository label from the canonical Git root and the suffix from the trusted checkout identity. An existing short-ID path is never reused or deleted: the identity expands from 8 to 12 and then the full UUID form. Session and iteration remain registry/UI metadata rather than leaking into the Workspace basename. The target path becomes its own registered Harness Workspace, so the new Session's `workspace-write` boundary is correct without nesting the Worktree in Local.

### Human acceptance with reversible Local Preview

The old plugin flow wrote directly to Local on `worktree_apply`, advanced `applyBaseOid`, and could make a later Finish observe zero delta while Local remained modified. That surface stays disabled. The plugin now ports Domi's receipt-first Preview / Rollback / Finalize invariants behind Harness's official strict Typert Remote and public Client slots:

```text
Working
  → Ready for Review
  → read-only preflight
  → Local Preview active (no commit)
  → accept and commit / rollback
  → cleanup or retention
```

A low-frequency Ready shortcut can skip interactive Local review and directly finish, but internally still uses receipt-first Preview → Finalize under one Host mutation lock.

- `worktree_apply` is not registered as a model tool or command; Finish/Discard/Remove are not model tools.
- Ready primary action calls `preflight` then `preview`; Preview primary action calls `finalizePreview`; rollback is in the More menu; direct `finalize` is only the explicit “skip review” shortcut.
- The Host allocates one acceptance slot per canonical `localRoot`. A second task receives `project_acceptance_busy` until rollback/finalize releases the slot.
- Preview receipt persistence and internal refs precede Local writes. The receipt binds Local branch/HEAD/fingerprint, prior working/index trees, Preview tree, Isolated HEAD/fingerprint/snapshot, review ID, iteration, and changed files.
- Rollback and finalize revalidate receipt/HEAD/ref/fingerprint CAS. Local drift or edits inside Preview fail closed into `preview_detached`, release the slot, and preserve Worktree/recovery evidence.
- Crash reconciliation distinguishes pre-write interruption, retained Preview artifacts, rollback recovery, and branch-CAS interruption after commit creation.
- Historical records containing `applyBaseOid` fail closed for automatic Finish/Discard and tell the user to inspect Local.

### Caller scope

Global registry data is not a capability. Model and command lists filter by the original project and by `ownerSessionId === caller` or `sourceSessionId === caller`. Management validates the caller first; only then may the internal state machine act on the stored owner binding.

### Runtime context

A replay-stable dynamic context reports only the current registry state:

- Local with no target;
- Local handoff pending (stop modifications and open the target card);
- Isolated Working (authoritative cwd and Local boundary);
- Ready for Review (model stops; user previews, directly finishes, or discards);
- Local Preview active/detached (model and Local Session remain read-only);
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
| Reversible Local Preview / Finalize / Rollback | Implemented through strict Remote with durable receipts, single-project slot, CAS and recovery |
| Global Worktree Manager sheet | Deferred until a stable Host Remote/Projection management seam is added |
| Electron reveal/close-session choreography | Replaced only by Web Workspace/Session navigation; immediate cleanup makes the isolated Session terminal |
| Collaborator release/handoff UI | Partial domain remnants only; no complete Host lifecycle integration |
| Dependency snapshot/restore | Deferred |
| Audit timing pipeline | Deferred |
| Workflow `agent({ isolation })` | Blocked by Harness's deferred workflow isolation option |

Subagents inherit their parent's persisted cwd. They are therefore isolated when spawned from the real target Session, but this plugin does not add a separate per-child Worktree policy.

## Verification map

- `tests/session-checkout-module.test.ts`: real Worktree creation plus Preview→rollback, Preview→finalize, direct finish, Preview-aware discard, Local drift, slot contention, crash recovery, caller scope, and legacy Apply fail-closed.
- `tests/session-checkout-apply.test.ts`: real Git preflight/Preview/rollback/finalize/Finish/fingerprint behavior, including fresh-engine receipt recovery.
- `tests/client-review-console.test.tsx` and `tests/client-target-console.test.tsx`: Ready/Preview/recovery actions, revision refresh, modal confirmation, dock projection and Preview-aware Discard.
- `scripts/check-publish.mjs`: every package export, Host patch, Host metadata, `dsh.client`, and executable browser ModuleLoader closure.
