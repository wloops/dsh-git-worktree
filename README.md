# dsh-git-worktree

Domi-grade git worktree isolation and delivery for DeepSeek Harness: permanent worktrees, a ready-for-review / apply / finish / discard lifecycle, conflict handling, and safe cleanup.

> Ported from [Domi](https://github.com/wloops/domi)'s production worktree system (Session Target / Isolated Checkout), with the Local-preview surface removed to match the DSH sandbox model.

## What you get

| Capability | Description |
| --- | --- |
| `worktree_create` / `worktree_list` / `worktree_remove` | Permanent detached worktrees under `<repo>/.dsh-worktrees/`, recorded in a per-repo manifest and registered as DSH workspaces |
| `worktree_ready_for_review` | Agent submits review facts (summary, validation tests, suggested commit message) |
| `worktree_apply` | Deterministically merge the worktree's changes into your Local checkout — conflict-aware, fingerprint-CAS, never touches Local until the plan is verified |
| `worktree_finish` | Commit the task delta onto your Local branch while preserving your own staged/working state |
| `worktree_discard` | Drop the worktree (dirty confirmation required) |
| `/worktree` | Human-facing command surface |
| Safe cleanup | Retained worktrees expire, residue is quarantined, dirty worktrees are never silently deleted, no global `git worktree prune` |

## Why worktrees live inside the repo

DSH's `workspace-write` sandbox grants exactly the session workspace root. Worktrees therefore live at `<repo>/.dsh-worktrees/<name>` (same pattern as Codex's `.codex/worktrees`), so agent file tools and git operations stay inside the sandbox.

## Install

```sh
# from npm (recommended)
dsh plugin --profile web add dsh-git-worktree

# or from GitHub source (built on install via the prepare script)
dsh plugin --profile web add github:wloops/dsh-git-worktree#v0.1.2
```

Git installs build the package on the fly. On pnpm ≥ 10 that build script is
blocked until allowed: add `dsh-git-worktree: true` under `allowBuilds` in the
profile's `pnpm-workspace.yaml`, then re-run the add command.

## Status

Pre-release (`0.1.0`). The state machine and apply engine are ported from Domi's production code (journal-based crash recovery, fingerprint CAS, Windows cleanup retries); the DSH tool surface is new and being hardened. Requires DSH `0.1.0-rc.6` line (`@deepseek-ai/dsh-tools` / `dsh-subprocess` / `dsh-commands`).

## License

MIT
