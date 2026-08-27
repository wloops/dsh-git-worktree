# dsh-git-worktree

[![npm](https://img.shields.io/npm/v/dsh-git-worktree)](https://www.npmjs.com/package/dsh-git-worktree)
[![npm downloads](https://img.shields.io/npm/dm/dsh-git-worktree)](https://www.npmjs.com/package/dsh-git-worktree)
[![CI](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml/badge.svg)](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Let agents work in real Git worktrees, preview the result in Local, and commit only after explicit human approval.**

`dsh-git-worktree` is an experimental Session Target plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). Each coding task runs in its own checkout and Session, so the Local workspace controlled by the user does not become the agent's construction site.

This is an independent community plugin. It is not an official DeepSeek project and does not imply endorsement, partnership, or authorization.

This is more than a wrapper around `git worktree`. It provides a complete delivery lifecycle: create an isolated environment, iterate safely, prepare a review, preview the task in Local without committing, finalize one task-only commit, and preserve recovery evidence when safety cannot be proven.

> Its Worktree safety foundation originates from workflows used in the author's internal desktop project **Domi**. This plugin is independently adapted for Harness and does not require Domi to install or run.

[中文文档](README.md)

## What problem does it solve?

When an agent edits the current working tree directly, several concerns become entangled:

- task changes mix with existing staged, unstaged, and untracked Local state;
- multiple agent tasks sharing one checkout can overwrite files, switch branches, or contaminate each other's commit boundaries;
- multiple tasks writing results into Local at the same time can interfere with Preview, conflict handling, and cleanup;
- it becomes difficult to tell which bytes belong to the current task;
- “show me the result” may already mean an irreversible write into Local;
- commit, cleanup, and recovery decisions may depend too heavily on model judgment;
- starting another coding round often means losing the original conversation or rebuilding its context.

This plugin separates a coding task into two explicit boundaries:

1. **The agent implements and validates in an Isolated Worktree.**
2. **The user reviews the result in Local and decides whether to commit it.**

## Highlights

- **Real isolation** — every task gets a distinct Git worktree, Harness Workspace, cwd, and Session ID.
- **Human-gated delivery** — the model may prepare a review, but it cannot Preview, Commit, Discard, or delete the Worktree by itself.
- **Reversible Local Preview** — inspect the task in Local without creating a commit, then accept it or remove only that Preview.
- **Local state preservation** — existing staged, unstaged, and untracked Local changes are not automatically folded into the task commit.
- **Parallel preparation, serialized acceptance** — multiple Isolated Worktrees may prepare tasks concurrently, while one active Preview per Local project prevents review drafts from being written over each other.
- **Stop on conflict instead of overwriting** — overlapping changes, Local drift, branch movement, or an inseparable delta enters conflict/recovery rather than silently choosing one side.
- **Task-only commit** — acceptance creates one commit for the isolated task while preserving separable Local work.
- **Save stage and continue** — a Ready or active Preview can be explicitly saved as a managed-Worktree-only Checkpoint. The stage commit never enters Local; development resumes from a clean worktree, and final delivery still creates one cumulative Local task commit.
- **Continuous Session iterations** — after delivery and cleanup, iteration + 1 can start in the same Session with the full conversation intact.
- **Automatic read-only Preflight** — once Ready, the Review card and composer dock show Local/Worktree HEAD, effective base, sync conditions, conflicts, and the acceptance slot without writing Local.
- **Agent recovery continuation** — a conflict resumes Working only after an explicit user click, then sends the Local HEAD and conflict files to the exact owner Agent through the official Harness Session API; `stale_isolated` stays strictly read-only and only regenerates the review.
- **Host-authoritative Detached Preview recovery** — when Local drift moves a Preview into `preview_detached`, the Host read-only checks the receipt, retained refs, HEAD/ref, index, working tree, and acceptance slot. Rollback or Finalize appears only when a fresh proof marks it safe; the user may also request read-only Agent analysis or hand off from the latest Local HEAD into a fresh Worktree.
- **Verifiable Delivery Proof** — after Finalize, the UI shows the Commit OID, Local branch/HEAD, file and validation summaries, and cleanup/retention results.
- **Fail-closed recovery** — stale reviews, Local drift, branch changes, concurrent Previews, and uncertain cleanup stop instead of overwriting data.

> The current scope is a project-scoped Worktree Session workflow, not a cross-project global Worktree Manager. The project is still experimental; use it first in Git repositories that you can recover independently.

### Parallel tasks and conflict boundaries

Multiple tasks can edit, test, and prepare reviews concurrently in separate Worktrees, Workspaces, and Sessions without sharing one checkout. Local acceptance is deliberately serialized: one canonical Local project has one acceptance slot. Until the active Preview is committed or rolled back, another task receives `project_acceptance_busy` instead of layering another write into Local.

“Parallel tasks” does not mean “automatically merge every conflict.” If a task overlaps Local changes, its review becomes stale, the branch moves non-fast-forward, or the Host cannot prove that Rollback/Finalize will preserve unrelated work, the operation stops and retains recovery evidence for the user to resolve.

## Workflow

```text
Local Session
    │
    ├─ Create isolated Worktree Session
    ▼
Agent edits and validates in the Worktree
    │
    ├─ worktree_ready_for_review
    ▼
Ready for Review
    │
    ├─ Save stage and continue ── Worktree-only Checkpoint
    ├─ Sync to Local Preview ── Accept and commit
    │                         ├─ Roll back and continue editing
    │                         └─ Roll back Preview, save stage, continue
    ├─ Skip Preview and commit directly
    └─ Discard
    │
    └─ After cleanup: start iteration + 1 in the same Session
```

### 1. Create an isolated Session

In a blank/new Local Session, enable **Worktree** and confirm creation. Nothing is created before confirmation. After confirmation, the unsent text and image draft is transferred to the new isolated Session.

An existing Local Session may also ask the model to call `worktree_create`. The source Session remains Local and is never silently switched to another cwd.

### 2. Work inside the Worktree

The agent reads, edits, and validates only inside the isolated cwd. That cwd is a real Git worktree and is registered as a Harness Workspace, so Harness Workspace and Session boundaries remain authoritative.

### 3. Prepare the review

When implementation and validation are complete, the agent calls `worktree_ready_for_review` with:

- a change summary;
- changed files;
- validation status and test commands;
- a suggested commit message.

This stores a review report. It does not write to Local and does not create a commit. Once Ready appears, the dedicated Review card and composer dock automatically run a strictly read-only Preflight that shows Local/Worktree HEAD, effective base, changed-file count, conflicts, and the acceptance slot. Both surfaces share the same read result, but Preview and direct Finalize always force a fresh check; cached display state is never write authorization.

### 4. Choose how to deliver

The user can then:

- **Save stage and continue** — commit the reviewed snapshot only inside the managed Worktree, clean the construction state, and resume Working;
- **Sync to Local for review** — create an uncommitted, reversible Preview;
- **Accept and commit** — commit only the cumulative task delta;
- **Roll back and continue editing** — remove the Preview and return to the Worktree;
- **Skip review and commit directly** — use the guarded direct-delivery path after explicit confirmation;
- **Discard** — clean up the task environment when all safety conditions pass.

Checkpoint is available only to the exact owner when the current Review, revision, generation, and acceptance slot still match. Under the Host lock it creates a Worktree-only commit, persists the operation journal and internal artifact, performs post-write verification, and invalidates the old Review/Preview/proof. An exact completed request ID can be replayed safely. For an active Preview, the same Host operation first performs a safe rollback; if rollback cannot be proven, recovery evidence is retained and the operation stops. Local branch/HEAD, index, staged, unstaged, untracked, and working-tree state never enter the Checkpoint commit, and multiple Checkpoints still deliver one final Local commit.

If Preflight reports `stale_local`, `stale_isolated`, or a conflict, old Preview/Finalize actions are disabled immediately. `stale_local` only refreshes read-only facts. A conflict resumes Working only after the user clicks **Let Agent resolve conflicts**: under the mutation lock, the Host reruns conflict Preflight/CAS, generates and persists an exact recovery proof, and only then lets the Client use the official Harness `ISession.prompt()` face to send structured Local HEAD and conflict-file context to the exact owner Session. **Regenerate review result** for `stale_isolated` keeps the target Ready and strictly read-only; the Host performs another read-only check and persists a separate, non-interchangeable proof without resuming Working or modifying files. Sending waits for the Session to load and stop streaming, then rechecks the Host proof field by field together with checkout/review/revision/cwd; duplicate clicks remain single-flight. Unsent requests survive a page refresh, but browser storage is untrusted context and must pass exhaustive kind, exact-field, OID, safe-relative-path, and Host-authority validation. An unknown in-flight result or an explicit failure requires a user-triggered retry. `project_acceptance_busy` exposes only a path-free holder summary; navigation happens only after the Host re-proves checkout, owner Session, and canonical cwd identity. After Finalize, the Review surface retains a Delivery Proof rather than collapsing to a generic success message.

#### Detached Preview recovery

When the Preview receipt is still intact but the Local branch/HEAD, index, or working tree has changed, delivery enters `preview_detached`. Here, detached is a delivery state, not Git detached HEAD. The Review surface automatically runs a strictly read-only Recovery Preflight and shows the Host generation, current Local HEAD/ref, and structured Rollback and Finalize conclusions.

- The recovery proof binds the exact Session, checkout, revision, Review, Preview, receipt fingerprint, four retained artifacts, Local fingerprint/trees, and acceptance-slot holder. It is deterministic revalidation context, not bearer permission.
- Safe Rollback, Finalize, read-only analysis, and fresh-Worktree handoff each bypass the display cache and fetch another proof. The Host then recomputes and compares it under the binding lock; any revision, Local, artifact, or slot change rejects the action before a write.
- On a provable same-branch fast-forward, Rollback removes only the Preview and Finalize commits only the task delta onto the latest Local HEAD. Later staged, unstaged, untracked, and committed Local work remains. Branch switches, non-fast-forward history, committed Preview bytes, hunk conflicts, or missing artifacts fail closed.
- **Let Agent analyze read-only** cannot modify the old Worktree, Local, refs/index, or artifacts. **Hand off to a fresh Worktree** creates a new managed checkout from the latest Local HEAD; failure leaves the old detached delivery, receipt, retained refs, Local state, and old Worktree unchanged.
- If an exact post-write check cannot prove the target HEAD/ref/index/tree/fingerprint, the checkout enters `recovery_required` and preserves its journal and evidence. A matching Commit HEAD alone is never treated as sufficient proof of completion, and the write is not retried automatically.

### 5. Start the next round in the same conversation

After a successful commit and cleanup, the current Worktree cwd is removed, but the Session and conversation remain. When the user requests more code or file changes, the plugin can recreate the immutable cwd from the latest Local HEAD and start the next iteration safely.

Retained, cleanup-pending, and recovery states are never removed silently. They must be handled before another iteration can begin.

## Screenshots

The following screenshots show the primary delivery flow in the order a task normally follows it.

### Create a Worktree Session

After Worktree is enabled in a new Local Session, Harness explains the Session-switch boundary. The isolated Session is created and selected only after explicit confirmation.

![Confirm creation and switch to a Worktree Session](docs/screenshots/01-create-worktree.png)

### Prepare the review

When implementation and validation finish, the agent prepares a Ready for Review report. The user can inspect the summary and validation evidence before syncing anything to Local.

![Worktree changes ready for review](docs/screenshots/02-ready-for-review.png)

### Review the Local Preview

After synchronization, the task delta waits in Local as a reversible Preview. The user can commit it, roll it back and continue editing, or discard the task.

![Task changes waiting for acceptance in Local Preview](docs/screenshots/03-local-preview.png)

### Confirm the commit and choose retention

The default path confirms the Commit Message and cleans up the Worktree after submission. When further investigation is useful, the frozen runtime environment can instead be retained for the selected period.

| Commit and clean up | Commit and retain the runtime environment |
| --- | --- |
| ![Confirm the task-only commit and clean up the Worktree](docs/screenshots/04-commit-confirmation.png) | ![Confirm the task-only commit and retain the runtime environment](docs/screenshots/06-retain-environment.png) |

### Start the next iteration in the same Session

After delivery and cleanup succeed, the conversation remains available and can begin another iteration from the latest Local HEAD.

![Delivered Session ready to start the next iteration](docs/screenshots/05-next-iteration.png)

## Design foundation and Harness adaptation

The Worktree lifecycle and Git delivery engine are adapted from a mature desktop implementation that has been exercised in real workflows. The goal is not to copy its UI, but to preserve proven safety invariants:

- managed checkout registry and revision CAS;
- canonical path, Git common-dir, and git-dir identity checks;
- complete fingerprints for staged, unstaged, untracked, binary, and deleted files;
- receipt-first Local Preview, Rollback, and Finalize;
- task-only commits that preserve unrelated Local work;
- internal refs, journal recovery, retention, quarantine, and conservative cleanup;
- fail closed whenever the Host cannot prove that a write is safe.

DeepSeek Harness has a different Host and Session model from the original desktop host, so the integration was adapted rather than copied mechanically:

- Harness Workspace and Session cwd are authoritative; the plugin registry is supporting state only;
- Host capabilities are exposed through strict Typert Remote, while browser UI uses public Harness Client Slots;
- Local source and Isolated target always use separate Sessions;
- cleanup does not mutate Harness's persisted Session cwd; the next iteration recreates the same path only after strict identity checks;
- the model creates targets, resolves conflicts only after explicit authorization, regenerates stale reviews read-only, and prepares reviews, while user-controlled surfaces own Local writes, commits, and cleanup.

See [Session Target porting notes](docs/PORTING.md) for the detailed identity, state, and recovery boundary mapping.

## Requirements

- Node.js `^22.19.0 || >=24.0.0`;
- DeepSeek Harness `0.1.1-rc.2` package line;
- Harness Web Client for the complete Worktree creation and acceptance UI;
- a Git repository as the current Workspace.

## Install

Install the npm package:

```bash
dsh plugin --profile web add dsh-git-worktree
```

Or install a specific Git tag:

```bash
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.6.0
```

With pnpm 10 or newer, a Git install may require this entry in the profile's `pnpm-workspace.yaml` before retrying:

```yaml
allowBuilds:
  dsh-git-worktree: true
```

Start Harness normally after installation and open a Git repository as the Workspace.

## Model tools and user controls

### Model tools

| Tool | Purpose |
| --- | --- |
| `worktree_create` | Create a managed Worktree from a Local Session and reserve a distinct target Session |
| `worktree_list` | List Worktrees visible to the current Session in the original project |
| `worktree_resume_revision` | Invalidate an unsynced review and resume the current iteration without touching Local |
| `worktree_begin_next_iteration` | Recreate the Worktree cwd for a delivered and successfully cleaned Session |
| `worktree_ready_for_review` | Save the delivery report and stop for explicit human acceptance |

Finish, Discard, Remove, and Local Preview are not model tools. Ordinary discussion leaves a Ready review unchanged; only new code or file work needs to resume Working.

### User controls

The Web UI provides the normal create, Preview, rollback, commit, retention, continue-editing, and discard actions. The `Local / Worktree · status` capsule in the Session Header opens the current-target controls and the Linked Worktrees manager directly; a source Session or any linked target Session can view the same source-linked tasks, navigate to their Sessions, and manage its own Worktree without returning to the original project. The manager stays focused on status, navigation, and owner lifecycle actions and does not regain inspect/review expansion. Automatic Preflight, stale/conflict recovery, acceptance-slot navigation, and Delivery Proof remain in the dedicated Review card and composer dock. Equivalent Host-controlled operations are also available through `/worktree` commands:

```text
/worktree status
/worktree list
/worktree continue
/worktree next
/worktree finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <commit message>
/worktree discard
/worktree remove <checkoutId>
```

`finalize` uses the suggested commit message from the current review. `finish` is the explicit direct-commit path with a user-provided message.

## Safety model

Every acceptance operation is revalidated by the Host. Browser display state and model-provided identity data are never treated as authority.

Important rules include:

- Local source and Isolated target use different Session IDs;
- an active target Workspace must canonicalize to the managed root recorded by the Host;
- one canonical Local project can have only one active Preview; a waiting owner keeps read-only Preflight but loses Preview/Finalize capability;
- an acceptance-slot blocker exposes only a path-free checkout/Session/state summary; opening it requires a fresh inspect plus owner and canonical-cwd verification;
- automatic Preflight creates no plan, slot, Git ref, or Local write; Preview and direct Finalize bypass display caches and check again; a waiting-to-available slot transition invalidates the old busy result, while automatic errors require an explicit retry;
- Preview receipts and internal refs are persisted before Local writes;
- Checkpoint binds exact owner, checkout, revision, review, generation, request ID, and acceptance slot. The Host atomically rolls back an active Preview, commits only the managed Worktree snapshot, verifies the write, invalidates old Review/Preview/proof state, and exposes neither paths nor internal refs through Remote;
- `preview_detached` Recovery Preflight is strictly read-only and rechecks all four retained artifacts before and after assessment; Remote proof stays path-free and never exposes Local or Worktree paths;
- Preview, Rollback, Finalize, Discard, and resume-editing paths bind checkout, revision, review, and fingerprint identity; detached mutation additionally requires a fresh generation that the Host recomputes under lock before journaling;
- Rollback removes only the delta proven to belong to the Preview and preserves separable Local changes made during review; Finalize commits only the task delta onto the latest same-branch Local HEAD;
- the final Local CAS occurs immediately before the first write, followed by exact HEAD/ref/index/tree/fingerprint verification; uncertain results enter `recovery_required` with the journal preserved and cannot be inferred successful from Commit HEAD alone;
- branch switches, non-fast-forward history, overlapping conflicts, committed Preview bytes, or additional drift enter recovery instead of being overwritten;
- cleanup verifies managed-path identity, Git metadata, and the final fingerprint; uncertain residue is retained or quarantined;
- durable Delivery Proof is bound to the exact Review and records Commit, Local branch/HEAD, changed files, and validation evidence; dynamic history evidence grants no mutation capability;
- historical records from the old irreversible Apply flow are not automatically finished or discarded.

See [Worktree Console architecture](docs/WORKTREE-CONSOLE-ARCHITECTURE.md) for the complete state model and authorization matrix.

## Current limitations

- There is no cross-project global Worktree Manager yet.
- The linked Worktree Manager opens from the Session Header control; a persistent `conversation.view` tab is still not mounted.
- Harness still presents Local and Worktree Sessions as separate Workspaces by canonical cwd. The plugin manager shows the `sourceSessionId` relationship without changing native sidebar grouping.
- Workflow `agent({ isolation })` integration is not available in the verified Harness `0.1.1-rc.2` line.
- Subagents inherit their parent Session cwd; they share the isolated boundary only when the parent is already a Worktree Session.
- Dependency snapshot/restore and the complete collaborator handoff UI have not yet been implemented.
- Checkpoint history is currently append-only metadata: editing, deleting, reordering, and arbitrary rollback are not supported.
- An Isolated Session cannot yet request a bounded transaction to repair the real Local checkout directly.
- Cleanup removes the current Worktree cwd, but a delivered Session can recreate the path and start another iteration after strict validation.

## Roadmap

The following items describe possible directions for continuing the project. They are not release-date commitments.

### Near term

- Continue improving marketplace presentation and end-to-end examples.
- Continue hardening Ready, Preview, Rollback, Finalize, cleanup, and iteration recovery.
- Improve error categories, recovery guidance, and compatibility across real Harness releases.
- Re-evaluate whether a persistent Worktrees tab is still useful in addition to the Header Manager.

### Medium term

- Continue improving Checkpoint history presentation from real long-running Harness task feedback.
- Evaluate a bounded Local repair transaction: a user-approved temporary authorization tied to the current Local state, allowing an Isolated Session to repair Local through restricted tools without changing its Session Target, then automatically resume the original task.
- Port dependency snapshot/restore to reduce repeated setup across Worktrees.
- Complete the collaborator/subagent handoff lifecycle so delegated work can be released and delivered safely.
- Continue enriching linked Worktree listing, inspection, retention, and cleanup management.
- Improve review presentation with clearer diff and validation information without weakening Host authority.

### Long term

- Build a cross-project global Worktree Manager.
- Integrate Workflow-level `agent({ isolation })` when Harness exposes a stable seam.
- Add richer audit, runtime metrics, and recovery diagnostics.
- Explore richer multi-task orchestration, serialized acceptance, and cross-Session handoff while preserving explicit human approval for every Local write.

## Local development

Install dependencies and run the standard checks:

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run check:publish
```

For an end-to-end local Harness run:

```bash
pnpm run dev:dsh
```

This command builds the current checkout, packs a temporary tarball, installs it into the `web` profile, validates the composed configuration, prepares a marker-protected disposable Git fixture, and starts `dsh web` at `http://127.0.0.1:3081` by default. It does not publish packages or push Git refs.

Useful variants:

```bash
# Install and verify the snapshot without starting Web
pnpm run dev:dsh:install

# Verify the already-installed profile
pnpm run dev:dsh:smoke

# Select another Git root, port, profile, or Harness source checkout
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web

# Remove the development install and cached local archives
pnpm run dev:dsh:remove
```

## Documentation

- [Session Target porting notes](docs/PORTING.md)
- [Worktree Console architecture](docs/WORKTREE-CONSOLE-ARCHITECTURE.md)
- [UI development notes](docs/UI-DEVELOPMENT.md)
- [Release checklist](docs/RELEASE.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
