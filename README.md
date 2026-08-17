# dsh-git-worktree

[![npm](https://img.shields.io/npm/v/dsh-git-worktree)](https://www.npmjs.com/package/dsh-git-worktree)
[![CI](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml/badge.svg)](https://github.com/wloops/dsh-git-worktree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Run coding tasks in real Git worktrees, review the result in Local, and commit only after explicit human approval.**

`dsh-git-worktree` is an experimental [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) plugin that turns a Git worktree into an isolated Session Target. The agent works in a separate checkout and Session; the original Local checkout stays under human control.

[中文文档](README.zh.md)

## Why use it?

A normal agent session can modify the same working tree you are using. This plugin separates execution from acceptance:

- **Real isolation** — each task gets a distinct Git worktree, Workspace, cwd, and Session ID.
- **Human-gated delivery** — the model can prepare a review, but it cannot commit, discard, or clean up by itself.
- **Reversible Local Preview** — inspect the exact change in Local before committing, then accept it or roll it back.
- **Local changes are preserved** — staged, unstaged, and untracked Local state is kept separate from the task change.
- **Fail-closed recovery** — stale reviews, conflicting edits, changed branches, and uncertain cleanup stop instead of overwriting data.

> The project is still experimental. It provides a project-scoped Worktree Session workflow, not a cross-project global worktree manager.

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

1. In a blank Local Session, turn on **Worktree** and confirm creation. The unsent text/image draft moves to the isolated Session; cancelling creates nothing.
2. For an existing Local Session, the model can call `worktree_create`, after which you open the isolated Session from its ToolView.
3. The agent edits and validates only inside the isolated cwd.
4. The agent ends with `worktree_ready_for_review`, including changed files, validation evidence, and a suggested commit message.
5. You choose what happens next:
   - **Sync to Local for review**, then commit or roll the Preview back;
   - **Skip review and commit directly**;
   - **Discard** the task.
6. After a successful commit and cleanup, the delivered Session can start the next iteration without losing its conversation. Harness keeps Session cwd immutable, so the plugin recreates only the previously cleaned, Host-owned managed path after strict identity checks.

All acceptance paths revalidate the review revision, Worktree HEAD/fingerprint, and Local state before writing. Retained or cleanup-pending environments must be cleaned first; starting another iteration never silently removes them.

## Requirements

- Node.js 20 or newer
- DeepSeek Harness `0.1.0-rc.6` package line
- Harness Web client for the interactive Worktree controls
- A Git repository

## Install

```bash
# npm package
dsh plugin --profile web add dsh-git-worktree

# Git tag; prepare builds the Host and Client bundles
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.3.0
```

With pnpm 10 or newer, a Git install may require this entry in the profile's `pnpm-workspace.yaml` before retrying:

```yaml
allowBuilds:
  dsh-git-worktree: true
```

Start Harness normally after installation and open a Git repository as the workspace.

## User and model controls

### Model tools

| Tool | Purpose |
| --- | --- |
| `worktree_create` | Create a managed Worktree and reserve a distinct target Session without changing the current Session cwd |
| `worktree_list` | List Worktrees visible to the current Session within the original project |
| `worktree_resume_revision` | Automatically invalidate an unsynced review before new code/file changes and resume the same iteration without touching Local |
| `worktree_begin_next_iteration` | Recreate a successfully cleaned delivered Session cwd for iteration + 1, preserving the same Session and conversation |
| `worktree_ready_for_review` | Save the delivery report and stop for explicit human acceptance |

Finish, Discard, and Remove are deliberately excluded from the model tool surface. While an unsynced review is waiting, ordinary discussion continues without changing it; if a follow-up requests code or file changes, the model calls `worktree_resume_revision` automatically. The user does not need to synchronize Local or click a recovery control.

### User controls

The Web UI provides the normal create, Preview, rollback, commit, retention, and discard actions. The same Host-controlled operations are also available through `/worktree` commands:

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

`finalize` uses the suggested commit message from the active review. `finish` is the explicit direct-commit path with a custom message.

## Safety model

The implementation ports Domi's hardened checkout/apply foundations to Harness's authoritative Workspace and Session cwd model. Important invariants include:

- The initial Local source and isolated target use different Session IDs; later iterations keep the same isolated Session ID.
- An active target is trusted only when its Harness Workspace resolves to the recorded managed root. A cleaned delivered target may temporarily reference its missing immutable cwd only when the Host path identity exactly matches the predecessor record.
- One canonical Local project can have only one active Preview.
- Preview receipts are persisted before Local writes so rollback/finalize can recover after a Host restart.
- Preview, commit, rollback, and resume-revision paths use revision and identity checks; review-based paths bind the review ID, and resume-revision changes only registry delivery state after validating the managed checkout.
- Cleanup verifies path identity, Git metadata, and the final fingerprint; uncertain residue is retained or quarantined.
- Next iteration creation only reuses an absent path from a successfully cleaned predecessor, creates a new checkout record, and preserves the predecessor as recovery evidence.
- Legacy records created by the old irreversible Apply flow are not automatically finished or discarded.

For the detailed boundary and recovery design, see [Porting notes](docs/PORTING.md) and [Worktree Console architecture](docs/WORKTREE-CONSOLE-ARCHITECTURE.md).

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

This command builds the current checkout, packs it into a temporary local tarball, installs it into the `web` profile, verifies the composed configuration, prepares a marker-protected disposable Git fixture, and starts `dsh web` at `http://127.0.0.1:3081` by default. It does not publish to npm or push Git refs.

Useful variants:

```bash
# Install and verify the snapshot without starting Web
pnpm run dev:dsh:install

# Verify the already-installed profile
pnpm run dev:dsh:smoke

# Use an existing Git root, another port, or another profile
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web

# Remove the development install and cached local archives
pnpm run dev:dsh:remove
```

When nearby DeepSeek Harness source checkouts are found, `dev:dsh` prefers a runnable candidate with `node_modules/tsx` installed. Select a checkout in any other location with `DSH_HARNESS_ROOT` or `--harness <path>`. Once a source checkout is selected, plugin installation, config validation, removal, and Web startup all use that source CLI without requiring a globally installed `dsh`. If an explicitly selected checkout has not installed its dependencies, the workflow fails before building and prints the corresponding `pnpm --dir <path> install` command. Only runs without a source checkout fall back to `dsh` on PATH.

## Current limitations

- No cross-project global sidebar manager yet.
- The project-scoped Worktree Console implementation exists, but its visible `conversation.view` tab is not mounted in `v0.3.0` while the primary flow is stabilised.
- In the verified Harness `0.1.0-rc.6` line, Workflow `agent({ isolation })` integration is not available.
- In that Harness line, subagents inherit the parent Session cwd; they are isolated only when the parent is already a Worktree Session.
- Dependency snapshot/restore and the complete collaborator handoff UI are deferred.
- Immediate cleanup removes the isolated cwd, making that Session terminal; continue from Local or start a new iteration.

## Documentation

- [Porting from Domi to Harness](docs/PORTING.md)
- [Worktree Console architecture](docs/WORKTREE-CONSOLE-ARCHITECTURE.md)
- [UI development notes](docs/UI-DEVELOPMENT.md)
- [Release checklist](docs/RELEASE.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
