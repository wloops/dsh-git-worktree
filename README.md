# dsh-git-worktree

An **experimental** Git worktree Session Target plugin for DeepSeek Harness. It ports Domi's hardened checkout/apply engine and adapts the product flow to Harness's authoritative Workspace/Session cwd model.

> Current scope: real isolated Sessions, a Harness-native Session Target/Worktree Console, reversible Local Preview, accept/rollback/direct-finish flows, a project-scoped acceptance slot, durable recovery receipts, retention, crash recovery, fingerprint CAS, and conservative cleanup. It is not yet Domi's cross-project global Worktree Manager.

## How it works

1. On a blank/new Local Session, clicking the **Worktree** switch first opens a confirmation dialog. Cancel creates nothing; confirm freezes the Local composer, creates the isolated target, transfers the unsent text/image draft, and opens the target. The user still sends the first prompt through the target's native composer, so no prompt is admitted to Local.
2. Existing Local Sessions can also create a target from the **Worktree** tab, and the model may call `worktree_create`.
3. The plugin creates a unique detached Worktree in a sibling container (with a plugin-state fallback) and reserves a distinct target Session ID. The source Session stays Local.
4. Harness registers the Worktree path as a Workspace, creates the exact Host-reserved Session, and opens it. Its persisted Session header cwd is the authoritative Session Target.
5. The agent changes and validates code only in that isolated cwd, then calls `worktree_ready_for_review` as its final model action.
6. A Domi-style status strip stays visible above the target composer when the Worktree is ready. Its compact Chinese Review card shows only the summary, validation state, file count, and collapsed test evidence—no Diff/Inspect controls or expanded retention buttons.
7. The Ready primary action is **同步到 Local 验收**. The Host runs a read-only preflight and then creates an uncommitted, reversible Local Preview of the exact review. While Preview is active, the primary action becomes **验收通过并提交** and the More menu can roll the Preview back and resume Worktree editing. Ready's More menu also offers **跳过验收，直接提交** and Discard.
8. Preview, rollback, and finalize are bound to revision/review/HEAD/fingerprint CAS. One canonical Local project can hold only one active Preview. Discard must roll an active Preview back first. Rollback may cross a same-branch fast-forward only when tree proofs show that it can remove Preview alone while preserving the new commit and prior Local layers; branch changes, rewritten history, committed Preview bytes, and content conflicts still fail closed with the Worktree and receipt preserved.

## Surface

### Model tools

| Tool | Purpose |
| --- | --- |
| `worktree_create` | Reserve a unique Worktree and distinct owner Session; does not mutate the current Session cwd |
| `worktree_list` | List only Worktrees owned or created by the current Session in the original project |
| `worktree_ready_for_review` | Persist the delivery report and stop for explicit human acceptance |

Apply, Finish, Discard, and Remove are intentionally **not model tools**. A model parameter is not trusted user authorization.

### Harness-native Worktree Console

The Client mounts the package-owned strict Typert Remote contribution through the official Gateway. A blank Local Session gets a compact **Worktree** switch in Harness's public composer tool row. Clicking it opens a confirmation dialog; only confirmation prepares the Host-allocated target and transfers the unsent text/image draft before navigation. The normal Harness Send path remains the only prompt path. Every persisted Session also gets a target capsule and a project-scoped **Worktree** view for advanced Create/Open/Inspect/Discard/Cleanup management. When Ready, `conversation.input.dock` shows one compact acceptance strip with a single primary action and a More menu; the historical ToolView stays compact and replayable. List rows remain path-free; authorized paths are returned only by `current`, `create`, or `inspect`.

### Human command

```text
/worktree status
/worktree list
/worktree finalize [cleanup|retain_24h|retain_3d|retain_manual]
/worktree finish <custom commit message>
/worktree discard
/worktree remove <checkoutId>
```

The Client uses strict Remote `preflight`, `preview`, `rollbackPreview`, and `finalizePreview`; `finalize` is reserved for an explicitly selected direct-finish shortcut. Every path carries the exact review ID/revision, and commit paths also carry the user-confirmed 1–500 character Commit Message plus retention. The Host revalidates caller, project, managed cwd, review identity, HEAD/fingerprint, and Local CAS; stale cards, post-review edits, and Local drift fail closed.

## Safety properties

- Source and target Sessions have different IDs; the source Session is never privately relabelled as isolated.
- The switch confirmation creates no resources. After confirm, the pre-session transaction blocks the source composer and opens the target only after its managed Workspace, exact Session ID, draft transfer, and source draft-revision CAS succeed; failures leave the source draft untouched.
- Target access fails closed unless its Harness Workspace path canonicalizes to the recorded managed root.
- New paths use `<repo>--worktrees/<repo>--<checkout-short>--worktree`; identity expands on collision instead of overwriting unknown paths. Unsafe siblings fall back to `<stateDir>/worktrees/<repository-key>/`, while legacy registry paths remain manageable.
- Legacy records that already used the old irreversible Apply path cannot automatically Finish or Discard; the user must first inspect Local.
- Lists and management actions are caller-scoped. A recorded `ownerSessionId` is never used as authorization by itself.
- A Preview receipt is persisted before Local writes and retains the prior working tree/index, Preview tree, and Isolated snapshot, so rollback/finalize can recover after Host restart. Same-branch fast-forward rollback first proves that the new HEAD does not contain Preview, then replays prior Local layers with pre-write and post-write CAS.
- A canonical Local root has one acceptance slot. Detached Previews release the slot while retaining recovery evidence.
- Finish preserves unrelated Local staged/working state and refuses stale Local or stale Isolated fingerprints. Discard of an active Preview must first roll it back safely.
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

- The old direct `worktree_apply` surface remains disabled; public delivery is limited to explicit user Preview/rollback/finalize/direct-finish actions.
- No cross-project global sidebar Manager yet; management is intentionally project- and Session-scoped in the Worktree Console.
- No automatic Workflow `agent({ isolation })`; Harness still defers that option.
- Subagents inherit the parent Session cwd, so they are isolated only after the parent is a real Worktree Session.
- Dependency snapshot/restore and complete collaborator handoff UI are deferred.
- Finishing with immediate cleanup makes the isolated Session terminal because its cwd is removed; open a Local/new iteration Session for follow-up work.

See [docs/PORTING.md](docs/PORTING.md) for the Domi-to-Harness boundary and [docs/RELEASE.md](docs/RELEASE.md) for release gates.

## License

MIT
