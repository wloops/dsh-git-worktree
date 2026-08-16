# dsh-git-worktree

An **experimental** Git worktree Session Target plugin for DeepSeek Harness. It ports Domi's hardened checkout/apply engine and adapts the product flow to Harness's authoritative Workspace/Session cwd model.

> Current scope: real isolated Session creation, a Harness-native Session Target/Worktree Console, review-bound diff and ToolViews, human-confirmed task-only Finish, retention, crash recovery, fingerprint CAS, and conservative cleanup. It is not yet a complete replacement for Domi's global Worktree Manager or reversible Local Preview.

## How it works

1. In a Local Session, the user creates a target from the **Worktree** tab, or the model calls `worktree_create`.
2. The plugin creates a unique detached Worktree in a sibling container (with a plugin-state fallback) and reserves a distinct target Session ID. The source Session stays Local.
3. The Create ToolView's **Open isolated session** action registers the Worktree path as a Harness Workspace, creates the exact reserved Session, and opens it. Its persisted Session header cwd is the authoritative Session Target.
4. The agent changes and validates code only in that isolated cwd, then calls `worktree_ready_for_review` as its final model action.
5. The Worktree Console and replay-stable Review ToolView show the review-bound diff, validation evidence, changed files, and suggested commit message. The user explicitly chooses **Finalize cleanup** or a retention option.
6. `/worktree finalize ...` creates one task-only commit on Local while preserving unrelated Local staged, unstaged, and untracked work.

## Surface

### Model tools

| Tool | Purpose |
| --- | --- |
| `worktree_create` | Reserve a unique Worktree and distinct owner Session; does not mutate the current Session cwd |
| `worktree_list` | List only Worktrees owned or created by the current Session in the original project |
| `worktree_ready_for_review` | Persist the delivery report and stop for explicit human acceptance |

Apply, Finish, Discard, and Remove are intentionally **not model tools**. A model parameter is not trusted user authorization.

### Harness-native Worktree Console

The Client mounts the package-owned strict Typert Remote contribution through the official Gateway. Every Session gets a target status capsule and a project-scoped **Worktree** view for Create/Open/Inspect/Review/Discard/Cleanup. List rows remain path-free; authorized paths are returned only by `current`, `create`, or `inspect`. If the Remote is unavailable, historical ToolViews remain readable while all mutations stay disabled.

### Human command

```text
/worktree status
/worktree list
/worktree finalize [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <custom commit message>
/worktree discard
/worktree remove <checkoutId>
```

The client ToolViews invoke `finalize` as a user command carrying the card's exact review ID and revision. Finish rechecks the reviewed fingerprint/head before touching Local; stale cards or post-review edits require a new Ready snapshot. Commands also enforce owner/source scope, original project identity, and managed cwd identity.

## Safety properties

- Source and target Sessions have different IDs; the source Session is never privately relabelled as isolated.
- Target access fails closed unless its Harness Workspace path canonicalizes to the recorded managed root.
- Worktree paths are unique and normally outside Local, so Local `git status` and task indexes cannot accidentally absorb the Worktree as a gitlink.
- Legacy records that already used the old irreversible Apply path cannot automatically Finish or Discard; the user must first inspect Local.
- Lists and management actions are caller-scoped. A recorded `ownerSessionId` is never used as authorization by itself.
- Finish preserves unrelated Local staged/working state and refuses stale Local or stale Isolated fingerprints.
- Cleanup validates path, Git common-dir, git-dir, directory identity, and final fingerprint; uncertain residue is retained or quarantined.

## Install

```bash
# npm (recommended)
dsh plugin --profile web add dsh-git-worktree

# Git source (prepare builds Host + Client bundles)
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.1.2
```

On pnpm >= 10, Git installs may require `dsh-git-worktree: true` under `allowBuilds` in the profile's `pnpm-workspace.yaml` before retrying the add command.

Requires the DeepSeek Harness `0.1.0-rc.6` package line and the Web client for interactive ToolViews.

## One-command local development

For repeated iterations, run this from any current checkout, including a Domi managed Worktree:

```bash
pnpm run dev:dsh
```

The command runs typecheck/build, packs the **current checkout snapshot** into a local tarball under the OS temporary directory, installs it into the `web` profile, checks the composed config, creates or reuses a marker-protected disposable Git fixture, and finally starts `dsh web` from that fixture cwd (default `http://127.0.0.1:3081`). If a `DeepSeek/deepseek-harness` source checkout is found in the same development tree, it is preferred for launching DSH while the Session workspace remains the fixture; `DSH_HARNESS_ROOT` or `--harness <path>` can override it. The installed `dsh` on PATH is used only when no source checkout is available. The workflow never runs `npm publish`, pushes Git refs, or creates tags, and it does not leave a symlink pointing at a cleaned managed Worktree. The tarball currently referenced by the profile is retained; older local snapshots are cleaned after a successful install.

Useful entry points:

```bash
# Install and verify the current snapshot without starting Web
pnpm run dev:dsh:install

# Check the already-installed profile only
pnpm run dev:dsh:smoke

# Use an existing Git repository or another port/profile
pnpm run dev:dsh -- --repo G:/path/to/repo --port 4090 --profile web

# Explicitly uninstall from the profile and clear local development tarballs
pnpm run dev:dsh:remove
```

The default fixture is `dsh-git-worktree-dev/fixture` under the OS temporary directory. The workflow initializes only an absent or empty directory. Reuse requires its plugin marker, the exact Git-root identity, a clean status, and no leftover linked Worktrees. Unknown files, dirty state, symlinks, or retained Worktrees fail closed; the script never resets or deletes repository content. An explicit `--repo` must already be a Git root and is validated without initialization or rewriting.

## Current limitations

- No reversible Local Preview / Finalize / Rollback layer. The old direct `worktree_apply` surface is disabled.
- No cross-project global sidebar Manager yet; management is intentionally project- and Session-scoped in the Worktree Console.
- No automatic Workflow `agent({ isolation })`; Harness still defers that option.
- Subagents inherit the parent Session cwd, so they are isolated only after the parent is a real Worktree Session.
- Dependency snapshot/restore and complete collaborator handoff UI are deferred.
- Finishing with immediate cleanup makes the isolated Session terminal because its cwd is removed; open a Local/new iteration Session for follow-up work.

See [docs/PORTING.md](docs/PORTING.md) for the Domi-to-Harness boundary and [docs/RELEASE.md](docs/RELEASE.md) for release gates.

## License

MIT
