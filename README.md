# Git Control Center

Git Control Center is a workflow-first Git extension for VS Code. It is designed as a fast, IntelliJ-like Git hub with power-user actions and safe automation.

## Core Features

- Activity Bar container: **Git Control Center**
- Multi-root repository detection and active repository switching
- Views: Repositories, Branches, Changes, Commit, Stash, Worktrees, Log
- Status bar branch summary + one-click **Sync** button
- Git CLI-driven implementation (`git` binary), no dependency on GitLens

## Killer Differentiators (v1)

- **KD1: Branch Operations Panel**
  - `gitcc.branchActions` (context menu + shortcut) with: checkout, new branch from, merge/rebase, compare, log, upstream.
- **KD2: Smart Checkout**
  - `gitcc.smartCheckout` safely handles dirty state (auto-stash / commit flow / cancel) with optional stash apply/pop after switch.
- **KD3: One-Click Sync**
  - `gitcc.sync` runs fetch + pull + push with diverged-branch guided flow.
- **KD4: Favorite + Recent Branches**
  - Pin/unpin branches and quick checkout from recent list (persisted per repo in workspace state).
- **KD5: Worktree Awareness**
  - Worktrees view from `git worktree list --porcelain`, open and prune actions, optional create worktree command.
- **KD6: Actionable Errors**
  - Error notifications include “Fix It” actions for common scenarios (upstream missing, smart checkout, pull-then-push, etc).
- **KD7: Mini Log**
  - Fast commit list (last 20) with copy hash, open details, checkout commit (detached warning).
- **KD8: Command Center**
  - `gitcc.commandCenter` gives repo-aware quick actions with state hints.
- **KD9: Commit Assist**
  - Commit template autofill, staged file count/list, Commit & Sync support, post-commit action setting.
- **KD10: Branch Compare View**
  - Compare two branches with ahead/behind + unique commit lists in a lightweight webview.

## Commands

Primary commands:

- `gitcc.commandCenter`
- `gitcc.sync`
- `gitcc.branchActions`
- `gitcc.smartCheckout`
- `gitcc.compareBranches`
- `gitcc.checkoutRecentBranch`
- `gitcc.pinBranch` / `gitcc.unpinBranch`

Standard workflow commands:

- `gitcc.fetch`, `gitcc.pull`, `gitcc.push`, `gitcc.commit`, `gitcc.refresh`
- `gitcc.stageFile`, `gitcc.unstageFile`, `gitcc.stageAll`, `gitcc.unstageAll`, `gitcc.discardFile`, `gitcc.discardAll`
- `gitcc.checkoutBranch`, `gitcc.createBranch`, `gitcc.renameBranch`, `gitcc.deleteBranch`, `gitcc.setUpstream`
- `gitcc.stash`, `gitcc.unstash`, `gitcc.stashApply`, `gitcc.stashPop`, `gitcc.stashDrop`, `gitcc.stashBranch`
- `gitcc.openWorktree`, `gitcc.pruneWorktrees`, `gitcc.createWorktree`

## Settings

- `gitcc.refreshIntervalSeconds` (default `10`, min `5`, max `60`)
- `gitcc.pullRebase` (default `false`)
- `gitcc.showRemoteBranches` (default `true`)
- `gitcc.branchGroupingPrefixes`
- `gitcc.confirmForcePush` (default `true`)
- `gitcc.defaultRemote` (default `origin`)
- `gitcc.commitTemplate`
- `gitcc.smartCheckout.defaultStrategy` = `ask | autoStash | cancel` (default `ask`)
- `gitcc.postCommitAction` = `none | push | sync` (default `none`)
- `gitcc.enableTelemetry` (default `false`, no external calls)

## Keyboard Shortcuts

- `Ctrl/Cmd + Alt + G`: Command Center
- `Ctrl/Cmd + Alt + B`: Branch Actions
- `Ctrl/Cmd + Alt + C`: Smart Checkout

## Screenshots

- `![Repositories View](./docs/screenshots/repositories.png)`
- `![Branches View](./docs/screenshots/branches.png)`
- `![Changes + Commit](./docs/screenshots/changes-commit.png)`
- `![Stash View](./docs/screenshots/stash.png)`

## Run Locally

```bash
npm install
npm run compile
```

Then press `F5` in VS Code and choose **Run Git Control Center Extension**.

## Roadmap

- PR integration (GitHub/GitLab)
- Inline blame and code owners
- Interactive rebase UI
