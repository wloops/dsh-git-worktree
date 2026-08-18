# dsh-git-worktree

[![npm](https://img.shields.io/npm/v/dsh-git-worktree)](https://www.npmjs.com/package/dsh-git-worktree)
[![CI](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml/badge.svg)](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Let agents work in real Git worktrees, preview the result in Local, and commit only after explicit human approval.**

`dsh-git-worktree` is an experimental Session Target plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). Each coding task runs in its own checkout and Session, so the Local workspace controlled by the user does not become the agent's construction site.

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
- **Continuous Session iterations** — after delivery and cleanup, iteration + 1 can start in the same Session with the full conversation intact.
- **Review-to-edit recovery** — an unsynced review does not block discussion; a later file change safely resumes the current iteration first.
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
    ├─ Sync to Local Preview ── Accept and commit
    │                         └─ Roll back and continue editing
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

This stores a review report. It does not write to Local and does not create a commit.

### 4. Choose how to deliver

The user can then:

- **Sync to Local for review** — create an uncommitted, reversible Preview;
- **Accept and commit** — commit only the task delta;
- **Roll back and continue editing** — remove the Preview and return to the Worktree;
- **Skip review and commit directly** — use the guarded direct-delivery path after explicit confirmation;
- **Discard** — clean up the task environment when all safety conditions pass.

### 5. Start the next round in the same conversation

After a successful commit and cleanup, the current Worktree cwd is removed, but the Session and conversation remain. When the user requests more code or file changes, the plugin can recreate the immutable cwd from the latest Local HEAD and start the next iteration safely.

Retained, cleanup-pending, and recovery states are never removed silently. They must be handled before another iteration can begin.

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
- the model creates targets, resumes editing, and prepares reviews, while user-controlled surfaces own Local writes, commits, and cleanup.

See [Session Target porting notes](docs/PORTING.md) for the detailed identity, state, and recovery boundary mapping.

## Requirements

- Node.js 20 or newer;
- DeepSeek Harness `0.1.0-rc.6` package line;
- Harness Web Client for the complete Worktree creation and acceptance UI;
- a Git repository as the current Workspace.

## Install

Install the npm package:

```bash
dsh plugin --profile web add dsh-git-worktree
```

Or install a specific Git tag:

```bash
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.3.0
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

The Web UI provides the normal create, Preview, rollback, commit, retention, continue-editing, and discard actions. Equivalent Host-controlled operations are also available through `/worktree` commands:

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
- one canonical Local project can have only one active Preview;
- Preview receipts and internal refs are persisted before Local writes;
- Preview, Rollback, Finalize, Discard, and resume-editing paths bind checkout, revision, review, and fingerprint identity;
- Rollback removes only the delta proven to belong to the Preview and preserves separable Local changes made during review;
- branch switches, non-fast-forward history, overlapping conflicts, committed Preview bytes, or additional drift enter recovery instead of being overwritten;
- cleanup verifies managed-path identity, Git metadata, and the final fingerprint; uncertain residue is retained or quarantined;
- historical records from the old irreversible Apply flow are not automatically finished or discarded.

See [Worktree Console architecture](docs/WORKTREE-CONSOLE-ARCHITECTURE.md) for the complete state model and authorization matrix.

## Current limitations

- There is no cross-project global Worktree Manager yet.
- The project-scoped Worktree Console Host capabilities and components remain available, but the visible `conversation.view` tab is not mounted in `v0.3.0`.
- Workflow `agent({ isolation })` integration is not available in the verified Harness `0.1.0-rc.6` line.
- Subagents inherit their parent Session cwd; they share the isolated boundary only when the parent is already a Worktree Session.
- Dependency snapshot/restore and the complete collaborator handoff UI have not yet been implemented.
- A reviewed stage cannot yet be saved as an internal checkpoint before continuing development.
- An Isolated Session cannot yet request a bounded transaction to repair the real Local checkout directly.
- Cleanup removes the current Worktree cwd, but a delivered Session can recreate the path and start another iteration after strict validation.

## Roadmap

The following items describe possible directions for continuing the project. They are not release-date commitments.

### Near term

- Add complete product screenshots, marketplace presentation, and end-to-end examples.
- Continue hardening Ready, Preview, Rollback, Finalize, cleanup, and iteration recovery.
- Improve error categories, recovery guidance, and compatibility across real Harness releases.
- Re-evaluate mounting the project-scoped Worktree Console tab after the primary flow stabilizes.

### Medium term

- Add “save stage and continue” so long tasks can record reviewed stages inside the isolated checkout, continue from a clean worktree, and retain stage history in final acceptance.
- Evaluate a bounded Local repair transaction: a user-approved temporary authorization tied to the current Local state, allowing an Isolated Session to repair Local through restricted tools without changing its Session Target, then automatically resume the original task.
- Port dependency snapshot/restore to reduce repeated setup across Worktrees.
- Complete the collaborator/subagent handoff lifecycle so delegated work can be released and delivered safely.
- Add richer project-scoped Worktree listing, inspection, retention, and cleanup management.
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
