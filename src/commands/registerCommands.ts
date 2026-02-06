import * as vscode from 'vscode';
import * as path from 'node:path';
import { BranchInfo, CommitOptions, FileChange, MiniLogEntry, StashEntry } from '../types/git';
import { BranchesProvider } from '../providers/branchesProvider';
import { ChangesProvider } from '../providers/changesProvider';
import { CommitViewProvider } from '../providers/commitViewProvider';
import { MiniLogProvider } from '../providers/miniLogProvider';
import { RepositoriesProvider } from '../providers/repositoriesProvider';
import { StashProvider } from '../providers/stashProvider';
import { WorktreeTreeItem, WorktreesProvider } from '../providers/worktreesProvider';
import { BranchMemoryService } from '../services/branchMemoryService';
import { ConfigService } from '../services/configService';
import { ErrorReporter } from '../services/errorReporter';
import { GitService } from '../services/gitService';
import { RepositoryManager } from '../services/repositoryManager';

interface Providers {
  repositoriesProvider: RepositoriesProvider;
  branchesProvider: BranchesProvider;
  changesProvider: ChangesProvider;
  stashProvider: StashProvider;
  miniLogProvider: MiniLogProvider;
  worktreesProvider: WorktreesProvider;
  commitViewProvider: CommitViewProvider;
}

interface Deps {
  gitService: GitService;
  repositoryManager: RepositoryManager;
  configService: ConfigService;
  errorReporter: ErrorReporter;
  branchMemoryService: BranchMemoryService;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: Deps,
  providers: Providers,
): void {
  const register = <TArgs extends unknown[]>(command: string, cb: (...args: TArgs) => unknown) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (...args: unknown[]) => cb(...(args as TArgs))),
    );
  };

  const withRepo = async (
    fn: (repo: NonNullable<ReturnType<RepositoryManager['getActiveRepository']>>) => Promise<void>,
    operationLabel = 'Git operation',
  ) => {
    const repo = deps.repositoryManager.getActiveRepository();
    if (!repo) {
      await vscode.window.showWarningMessage('No active repository. Open a folder with Git and select a repository.');
      return;
    }

    try {
      await fn(repo);
      await refreshAll(deps, providers);
    } catch (error) {
      const action = await deps.errorReporter.show(error, operationLabel);
      await runErrorAction(action, deps, repo.rootUri);
    }
  };

  register('gitcc.refresh', async () => {
    await refreshAll(deps, providers, true);
  });

  // Backward-compat aliases for earlier typoed command ids.
  register('gitc.refresh', async () => {
    await vscode.commands.executeCommand('gitcc.refresh');
  });
  register('gitc.smartCheckout', async () => {
    await vscode.commands.executeCommand('gitcc.smartCheckout');
  });
  register('gitc.branchActions', async () => {
    await vscode.commands.executeCommand('gitcc.branchActions');
  });

  register('gitcc.openGitDashboard', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.git-control-center');
    await vscode.commands.executeCommand('gitcc.branches.focus');
  });

  register('gitcc.commandCenter', async () => {
    await withRepo(async (repo) => {
      const hints = [`${repo.currentBranch} ↑${repo.ahead} ↓${repo.behind}`, `${repo.dirtyCount} changed files`];
      const pick = await vscode.window.showQuickPick(
        [
          { label: `Repo: ${repo.name}`, description: hints.join(' • '), command: 'gitcc.switchRepository' },
          { label: 'Sync', command: 'gitcc.sync' },
          { label: 'Fetch', command: 'gitcc.fetch' },
          { label: 'Pull', command: 'gitcc.pull' },
          { label: 'Push', command: 'gitcc.push' },
          { label: 'Smart Checkout', command: 'gitcc.smartCheckout' },
          { label: 'Commit', command: 'gitcc.commit' },
          { label: 'Stash', command: 'gitcc.stash' },
          { label: 'Branch Actions', command: 'gitcc.branchActions' },
          { label: 'Refresh', command: 'gitcc.refresh' },
        ],
        { placeHolder: 'Git Control Center: Command Center' },
      );
      if (pick?.command) {
        await vscode.commands.executeCommand(pick.command);
      }
    }, 'Command Center');
  });

  register('gitcc.switchRepository', async (repoArg?: { id?: string }) => {
    const repos = deps.repositoryManager.getRepositories();
    if (repos.length === 0) {
      return;
    }

    const repository =
      repos.find((repo) => repo.id === repoArg?.id) ??
      (await vscode.window.showQuickPick(
        repos.map((repo) => ({ label: repo.name, description: repo.rootUri.fsPath, id: repo.id })),
        { placeHolder: 'Select active repository' },
      ));

    if (!repository) {
      return;
    }

    deps.repositoryManager.setActiveRepository(repository.id);
    await refreshAll(deps, providers);
  });

  register('gitcc.fetch', async () => {
    await withRepo(async (repo) => {
      const remote = deps.configService.get().defaultRemote;
      await deps.gitService.fetch(repo.rootUri, remote);
      void vscode.window.showInformationMessage(`Fetched ${remote}.`);
    }, 'Fetch');
  });

  register('gitcc.fetchBranches', async () => {
    await vscode.commands.executeCommand('gitcc.fetch');
  });

  register('gitcc.pull', async () => {
    await withRepo(async (repo) => {
      const config = deps.configService.get();
      await deps.gitService.pull(repo.rootUri, config.pullRebase, config.defaultRemote);
      void vscode.window.showInformationMessage('Pull complete.');
    }, 'Pull');
  });

  register('gitcc.push', async () => {
    await withRepo(async (repo) => {
      await deps.gitService.push(repo.rootUri, deps.configService.get().defaultRemote);
      void vscode.window.showInformationMessage('Push complete.');
    }, 'Push');
  });

  register('gitcc.sync', async () => {
    await withRepo(async (repo) => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Syncing ${repo.name}`,
          cancellable: false,
        },
        async (progress) => {
          const config = deps.configService.get();
          const remote = config.defaultRemote;
          progress.report({ message: 'Fetching...', increment: 20 });
          await deps.gitService.fetch(repo.rootUri, remote);

          let status = await deps.gitService.getStatus(repo.rootUri);
          if (status.ahead > 0 && status.behind > 0) {
            const choice = await vscode.window.showQuickPick(
              ['Rebase onto upstream', 'Merge upstream into current', 'Cancel'],
              { placeHolder: 'Branch is diverged. Choose a sync strategy.' },
            );
            if (choice === 'Cancel' || !choice) {
              return;
            }
            progress.report({ message: choice.startsWith('Rebase') ? 'Rebasing...' : 'Merging...', increment: 30 });
            if (choice.startsWith('Rebase')) {
              if (!status.upstream) {
                throw new Error('no upstream configured');
              }
              await deps.gitService.rebaseCurrentOnto(repo.rootUri, status.upstream);
            } else {
              if (!status.upstream) {
                throw new Error('no upstream configured');
              }
              await deps.gitService.mergeIntoCurrent(repo.rootUri, status.upstream);
            }
          } else if (status.behind > 0) {
            progress.report({ message: 'Pulling...', increment: 30 });
            await deps.gitService.pull(repo.rootUri, config.pullRebase, remote);
          }

          status = await deps.gitService.getStatus(repo.rootUri);
          if (status.ahead > 0) {
            progress.report({ message: 'Pushing...', increment: 40 });
            await deps.gitService.push(repo.rootUri, remote);
          }

          progress.report({ message: 'Done', increment: 10 });
          void vscode.window.showInformationMessage('Sync complete.');
        },
      );
    }, 'Sync');
  });

  register('gitcc.forcePushWithLease', async () => {
    await withRepo(async (repo) => {
      const config = deps.configService.get();
      if (config.confirmForcePush) {
        const choice = await vscode.window.showWarningMessage(
          'Force push with lease can overwrite remote history. Continue?',
          { modal: true },
          'Force Push',
        );
        if (choice !== 'Force Push') {
          return;
        }
      }
      await deps.gitService.push(repo.rootUri, config.defaultRemote, true);
      void vscode.window.showInformationMessage('Force push with lease complete.');
    }, 'Force Push with Lease');
  });

  register('gitcc.commit', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.git-control-center');
    await vscode.commands.executeCommand('gitcc.commit.focus');
  });

  register('gitcc.commitNow', async (message: string, options: CommitOptions) => {
    await withRepo(async (repo) => {
      const trimmed = message.trim();
      if (!trimmed) {
        void vscode.window.showWarningMessage('Commit message is required.');
        return;
      }
      const status = await deps.gitService.getStatus(repo.rootUri);
      if (status.staged.length === 0) {
        void vscode.window.showWarningMessage('Nothing staged. Stage files before committing.');
        return;
      }

      await deps.gitService.commit(repo.rootUri, trimmed, options);
      const post = options.syncAfter ? 'sync' : options.pushAfter ? 'push' : deps.configService.get().postCommitAction;
      if (post === 'push') {
        await deps.gitService.push(repo.rootUri, deps.configService.get().defaultRemote);
      } else if (post === 'sync') {
        await vscode.commands.executeCommand('gitcc.sync');
      }

      void vscode.window.showInformationMessage('Commit complete.');
    }, 'Commit');
  });

  register('gitcc.stageFile', async (change?: FileChange) => {
    await withRepo(async (repo) => {
      const target = await resolveFileChange(change, providers.changesProvider, 'unstaged');
      if (!target) {
        return;
      }
      await deps.gitService.stageFile(repo.rootUri, target.path);
    }, 'Stage File');
  });

  register('gitcc.toggleCommitFile', async (payload?: { path?: string; stage?: boolean }) => {
    await withRepo(async (repo) => {
      const targetPath = payload?.path?.trim();
      if (!targetPath) {
        return;
      }
      if (payload?.stage) {
        await deps.gitService.stageFile(repo.rootUri, targetPath);
      } else {
        await deps.gitService.unstageFile(repo.rootUri, targetPath);
      }
    }, 'Toggle Commit File');
  });

  register('gitcc.unstageFile', async (change?: FileChange) => {
    await withRepo(async (repo) => {
      const target = await resolveFileChange(change, providers.changesProvider, 'staged');
      if (!target) {
        return;
      }
      await deps.gitService.unstageFile(repo.rootUri, target.path);
    }, 'Unstage File');
  });

  register('gitcc.stageAll', async () => {
    await withRepo(async (repo) => deps.gitService.stageAll(repo.rootUri), 'Stage All');
  });

  register('gitcc.unstageAll', async () => {
    await withRepo(async (repo) => deps.gitService.unstageAll(repo.rootUri), 'Unstage All');
  });

  register('gitcc.discardAll', async () => {
    await withRepo(async (repo) => {
      const choice = await vscode.window.showWarningMessage(
        'Discard all unstaged/untracked changes?',
        { modal: true },
        'Discard All',
      );
      if (choice !== 'Discard All') {
        return;
      }
      await deps.gitService.discardAll(repo.rootUri);
    }, 'Discard All');
  });

  register('gitcc.discardFile', async (change?: FileChange) => {
    await withRepo(async (repo) => {
      const target = await resolveFileChange(change, providers.changesProvider, 'unstaged');
      if (!target) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(`Discard changes in ${target.path}?`, 'Discard');
      if (choice !== 'Discard') {
        return;
      }
      await deps.gitService.discardFile(repo.rootUri, target.path);
    }, 'Discard File');
  });

  register('gitcc.stageHunk', async (change?: FileChange) => {
    await withRepo(async (repo) => {
      const target = await resolveFileChange(change, providers.changesProvider, 'unstaged');
      if (!target) {
        return;
      }
      await deps.gitService.stageHunk(repo.rootUri, target.path);
    }, 'Stage Hunk');
  });

  register('gitcc.openDiff', async (change?: FileChange) => {
    await withRepo(async (repo) => {
      const target = await resolveFileChange(change, providers.changesProvider);
      if (!target) {
        return;
      }
      await deps.gitService.openFileDiff(repo.rootUri, target.path);
    }, 'Open Diff');
  });

  register('gitcc.checkoutBranch', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branch =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Select branch to checkout'));
      if (!branch) {
        return;
      }
      await deps.gitService.checkoutBranch(repo.rootUri, branch.shortName);
      await deps.branchMemoryService.recordCheckout(repo.rootUri.fsPath, branch.shortName);
    }, 'Checkout Branch');
  });

  register('gitcc.smartCheckout', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const target =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Smart checkout target branch'));
      if (!target) {
        return;
      }

      const status = await deps.gitService.getStatus(repo.rootUri);
      if (status.conflicts.length > 0) {
        void vscode.window.showErrorMessage('Resolve conflicts before switching branches.');
        return;
      }

      const dirty =
        status.staged.length + status.unstaged.length + status.untracked.length + status.conflicts.length > 0;
      let autoStashed = false;
      if (dirty) {
        const strategy = deps.configService.get().smartCheckoutDefaultStrategy;
        let action: 'auto' | 'commit' | 'cancel' = 'cancel';
        if (strategy === 'autoStash') {
          action = 'auto';
        } else if (strategy === 'cancel') {
          action = 'cancel';
        } else {
          const pick = await vscode.window.showQuickPick(
            [
              { label: 'Auto-stash and checkout', value: 'auto' as const },
              { label: 'Open Commit flow', value: 'commit' as const },
              { label: 'Cancel', value: 'cancel' as const },
            ],
            { placeHolder: 'Working tree has changes. Choose a strategy.' },
          );
          action = pick?.value ?? 'cancel';
        }

        if (action === 'commit') {
          await vscode.commands.executeCommand('gitcc.commit');
          return;
        }
        if (action === 'cancel') {
          return;
        }

        const timestamp = new Date().toISOString().replace(/:/g, '-');
        await deps.gitService.stash(repo.rootUri, `auto: ${timestamp} ${status.branch}`);
        autoStashed = true;
      }

      await deps.gitService.checkoutBranch(repo.rootUri, target.shortName);
      await deps.branchMemoryService.recordCheckout(repo.rootUri.fsPath, target.shortName);

      if (autoStashed) {
        const choice = await vscode.window.showInformationMessage(
          'Auto-stash created. Apply stash now?',
          'Apply',
          'Pop',
          'Later',
        );
        if (choice === 'Apply') {
          await deps.gitService.stashApply(repo.rootUri, 'stash@{0}', false);
        } else if (choice === 'Pop') {
          await deps.gitService.stashApply(repo.rootUri, 'stash@{0}', true);
        }
      }
    }, 'Smart Checkout');
  });

  register('gitcc.createBranch', async () => {
    await withRepo(async (repo) => {
      const name = await vscode.window.showInputBox({ prompt: 'New branch name' });
      if (!name) {
        return;
      }
      await deps.gitService.createBranch(repo.rootUri, name, true);
      await deps.branchMemoryService.recordCheckout(repo.rootUri.fsPath, name);
    }, 'Create Branch');
  });

  register('gitcc.createBranchFromRemote', async (branchArg?: BranchInfo | { branch?: BranchInfo }) => {
    await withRepo(async (repo) => {
      let extractedBranch: BranchInfo | undefined;
      if (branchArg && typeof branchArg === 'object' && 'shortName' in branchArg && 'kind' in branchArg) {
        extractedBranch = branchArg as BranchInfo;
      } else if (branchArg && typeof branchArg === 'object' && 'branch' in branchArg) {
        extractedBranch = branchArg.branch;
      }
      if (!extractedBranch || extractedBranch.kind !== 'remote') {
        void vscode.window.showInformationMessage('Select a remote branch and run "New Branch From" from its context menu.');
        return;
      }

      const suggestedName = extractedBranch.shortName.replace(/^[^/]+\//, '');
      const newName = await vscode.window.showInputBox({
        prompt: `New branch from ${extractedBranch.shortName}`,
        value: suggestedName,
      });
      if (!newName) {
        return;
      }

      await deps.gitService.createBranchFrom(repo.rootUri, newName, extractedBranch.shortName);
      await deps.branchMemoryService.recordCheckout(repo.rootUri.fsPath, newName);
    }, 'New Branch From');
  });

  register('gitcc.renameBranch', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branch =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Select branch to rename'));
      if (!branch) {
        return;
      }
      const newName = await vscode.window.showInputBox({ prompt: 'New branch name', value: branch.shortName });
      if (!newName) {
        return;
      }
      await deps.gitService.renameBranch(repo.rootUri, branch.shortName, newName);
    }, 'Rename Branch');
  });

  register('gitcc.deleteBranch', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branch =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Select branch to delete'));
      if (!branch || branch.isCurrent) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(`Delete branch ${branch.shortName}?`, 'Delete');
      if (choice !== 'Delete') {
        return;
      }
      await deps.gitService.deleteBranch(repo.rootUri, branch.shortName);
    }, 'Delete Branch');
  });

  register('gitcc.branchActions', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const target =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Select branch for operations'));
      if (!target) {
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          'Checkout',
          'New Branch From...',
          'Merge Into Current...',
          'Rebase Current Onto...',
          'Compare With Current',
          'View Log (branch)',
          'Set/Change Upstream',
        ],
        { placeHolder: `Branch Operations: ${target.shortName}` },
      );

      if (!action) {
        return;
      }

      if (action === 'Checkout') {
        await vscode.commands.executeCommand('gitcc.checkoutBranch', target);
      } else if (action === 'New Branch From...') {
        const newName = await vscode.window.showInputBox({ prompt: `New branch from ${target.shortName}` });
        if (newName) {
          await deps.gitService.createBranchFrom(repo.rootUri, newName, target.shortName);
          await deps.branchMemoryService.recordCheckout(repo.rootUri.fsPath, newName);
        }
      } else if (action === 'Merge Into Current...') {
        if (!target.isCurrent) {
          await deps.gitService.mergeIntoCurrent(repo.rootUri, target.shortName);
        }
      } else if (action === 'Rebase Current Onto...') {
        if (!target.isCurrent) {
          await deps.gitService.rebaseCurrentOnto(repo.rootUri, target.shortName);
        }
      } else if (action === 'Compare With Current') {
        await vscode.commands.executeCommand('gitcc.compareWithCurrent', target);
      } else if (action === 'View Log (branch)') {
        const output = await deps.gitService.viewLog(repo.rootUri, target.shortName);
        const doc = await vscode.workspace.openTextDocument({ content: output || 'No commits.' });
        await vscode.window.showTextDocument(doc, { preview: false });
      } else if (action === 'Set/Change Upstream') {
        await vscode.commands.executeCommand('gitcc.setUpstream', target);
      }
    }, 'Branch Actions');
  });

  register('gitcc.pinBranch', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const target =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Pin which branch?'));
      if (!target) {
        return;
      }
      await deps.branchMemoryService.pin(repo.rootUri.fsPath, target.shortName);
    }, 'Pin Branch');
  });

  register('gitcc.unpinBranch', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const target =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Unpin which branch?'));
      if (!target) {
        return;
      }
      await deps.branchMemoryService.unpin(repo.rootUri.fsPath, target.shortName);
    }, 'Unpin Branch');
  });

  register('gitcc.checkoutRecentBranch', async () => {
    await withRepo(async (repo) => {
      const recent = deps.branchMemoryService.getRecents(repo.rootUri.fsPath);
      if (recent.length === 0) {
        void vscode.window.showInformationMessage('No recent branches yet.');
        return;
      }
      const pick = await vscode.window.showQuickPick(recent, { placeHolder: 'Checkout recent branch' });
      if (!pick) {
        return;
      }
      await deps.gitService.checkoutBranch(repo.rootUri, pick);
      await deps.branchMemoryService.recordCheckout(repo.rootUri.fsPath, pick);
    }, 'Checkout Recent Branch');
  });

  register('gitcc.mergeIntoCurrent', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branch =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Merge which branch into current?'));
      if (!branch || branch.isCurrent) {
        return;
      }
      await deps.gitService.mergeIntoCurrent(repo.rootUri, branch.shortName);
    }, 'Merge');
  });

  register('gitcc.rebaseCurrentOnto', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branch =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Rebase current onto which branch?'));
      if (!branch || branch.isCurrent) {
        return;
      }
      await deps.gitService.rebaseCurrentOnto(repo.rootUri, branch.shortName);
    }, 'Rebase');
  });

  register('gitcc.setUpstream', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branches = await deps.gitService.getBranches(repo.rootUri, repo.currentBranch);
      const local =
        branchArg && branchArg.kind === 'local'
          ? branchArg
          : branches.find((branch) => branch.kind === 'local' && branch.isCurrent);
      if (!local) {
        return;
      }
      const remote = await vscode.window.showQuickPick(
        branches
          .filter((branch) => branch.kind === 'remote')
          .map((branch) => ({ label: branch.shortName, description: branch.name })),
        { placeHolder: `Select upstream for ${local.shortName}` },
      );
      if (!remote) {
        return;
      }
      await deps.gitService.setUpstream(repo.rootUri, local.shortName, remote.label);
    }, 'Set Upstream');
  });

  register('gitcc.compareWithCurrent', async (branchArg?: BranchInfo) => {
    await withRepo(async (repo) => {
      const branch =
        branchArg ??
        (await pickBranch(deps.gitService, repo.rootUri, repo.currentBranch, 'Compare current with which branch?'));
      if (!branch) {
        return;
      }
      await openComparePanel(deps.gitService, repo.rootUri, 'HEAD', branch.shortName);
    }, 'Compare Branches');
  });

  register('gitcc.compareBranches', async () => {
    await withRepo(async (repo) => {
      const branches = await deps.gitService.getBranches(repo.rootUri, repo.currentBranch);
      const quick = branches.map((branch) => ({ label: branch.shortName, branch }));
      const left = await vscode.window.showQuickPick(quick, { placeHolder: 'Select left branch' });
      if (!left) {
        return;
      }
      const right = await vscode.window.showQuickPick(quick, { placeHolder: 'Select right branch' });
      if (!right) {
        return;
      }
      await openComparePanel(deps.gitService, repo.rootUri, left.label, right.label);
    }, 'Compare Branches');
  });

  register('gitcc.viewLog', async (target?: { path?: string }) => {
    await withRepo(async (repo) => {
      const output = await deps.gitService.viewLog(repo.rootUri, target?.path);
      const doc = await vscode.workspace.openTextDocument({ content: output || 'No commits.' });
      await vscode.window.showTextDocument(doc, { preview: false });
    }, 'View Log');
  });

  register('gitcc.openCommitDetails', async (entry?: MiniLogEntry) => {
    await withRepo(async (repo) => {
      if (!entry) {
        return;
      }
      const details = await deps.gitService.getCommitDetails(repo.rootUri, entry.hash);
      const doc = await vscode.workspace.openTextDocument({ content: details, language: 'diff' });
      await vscode.window.showTextDocument(doc, { preview: false });
    }, 'Open Commit Details');
  });

  register('gitcc.copyCommitHash', async (entry?: MiniLogEntry) => {
    if (!entry) {
      return;
    }
    await vscode.env.clipboard.writeText(entry.hash);
    void vscode.window.showInformationMessage(`Copied ${entry.shortHash}`);
  });

  register('gitcc.checkoutCommit', async (entry?: MiniLogEntry) => {
    await withRepo(async (repo) => {
      if (!entry) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `Checkout commit ${entry.shortHash} in detached HEAD mode?`,
        { modal: true },
        'Checkout',
      );
      if (choice !== 'Checkout') {
        return;
      }
      await deps.gitService.checkoutCommit(repo.rootUri, entry.hash);
    }, 'Checkout Commit');
  });

  register('gitcc.stash', async () => {
    await withRepo(async (repo) => {
      const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)' });
      await deps.gitService.stash(repo.rootUri, message, false);
    }, 'Stash');
  });

  register('gitcc.stashKeepIndex', async () => {
    await withRepo(async (repo) => {
      const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)' });
      await deps.gitService.stash(repo.rootUri, message, true);
    }, 'Stash Keep Index');
  });

  register('gitcc.unstash', async () => {
    await withRepo(async (repo) => {
      const stashes = await deps.gitService.getStashes(repo.rootUri);
      const selected = await pickStash(stashes, 'Select stash to apply/pop');
      if (!selected) {
        return;
      }
      const action = await vscode.window.showQuickPick(['apply', 'pop'], { placeHolder: 'Unstash action' });
      if (!action) {
        return;
      }
      await deps.gitService.stashApply(repo.rootUri, selected.ref, action === 'pop');
    }, 'Unstash');
  });

  register('gitcc.stashApply', async (stashArg?: StashEntry) => {
    await withRepo(async (repo) => {
      const stash = stashArg ?? (await pickStash(await deps.gitService.getStashes(repo.rootUri), 'Select stash to apply'));
      if (!stash) {
        return;
      }
      await deps.gitService.stashApply(repo.rootUri, stash.ref, false);
    }, 'Stash Apply');
  });

  register('gitcc.stashPop', async (stashArg?: StashEntry) => {
    await withRepo(async (repo) => {
      const stash = stashArg ?? (await pickStash(await deps.gitService.getStashes(repo.rootUri), 'Select stash to pop'));
      if (!stash) {
        return;
      }
      await deps.gitService.stashApply(repo.rootUri, stash.ref, true);
    }, 'Stash Pop');
  });

  register('gitcc.stashDrop', async (stashArg?: StashEntry) => {
    await withRepo(async (repo) => {
      const stash = stashArg ?? (await pickStash(await deps.gitService.getStashes(repo.rootUri), 'Select stash to drop'));
      if (!stash) {
        return;
      }
      const choice = await vscode.window.showWarningMessage(`Drop ${stash.ref}?`, 'Drop');
      if (choice !== 'Drop') {
        return;
      }
      await deps.gitService.stashDrop(repo.rootUri, stash.ref);
    }, 'Stash Drop');
  });

  register('gitcc.stashBranch', async (stashArg?: StashEntry) => {
    await withRepo(async (repo) => {
      const stash = stashArg ?? (await pickStash(await deps.gitService.getStashes(repo.rootUri), 'Select stash for new branch'));
      if (!stash) {
        return;
      }
      const branchName = await vscode.window.showInputBox({ prompt: 'Branch name from stash' });
      if (!branchName) {
        return;
      }
      await deps.gitService.stashBranch(repo.rootUri, branchName, stash.ref);
    }, 'Stash Branch');
  });

  register('gitcc.viewStashPatch', async (stashArg?: StashEntry) => {
    await withRepo(async (repo) => {
      const stash = stashArg ?? (await pickStash(await deps.gitService.getStashes(repo.rootUri), 'Select stash to view patch'));
      if (!stash) {
        return;
      }
      const output = await deps.gitService.stashShowPatch(repo.rootUri, stash.ref);
      const doc = await vscode.workspace.openTextDocument({ content: output || 'No patch.', language: 'diff' });
      await vscode.window.showTextDocument(doc, { preview: false });
    }, 'View Stash Patch');
  });

  register('gitcc.openMergeEditor', async (change?: FileChange) => {
    await withRepo(async (repo) => {
      const target = await resolveFileChange(change, providers.changesProvider, 'conflicts');
      if (!target) {
        return;
      }
      const uri = vscode.Uri.file(path.join(repo.rootUri.fsPath, target.path));
      await vscode.commands.executeCommand('git.openMergeEditor', uri);
    }, 'Open Merge Editor');
  });

  register('gitcc.abortMergeOrRebase', async () => {
    await withRepo(async (repo) => {
      await deps.gitService.abortMergeOrRebase(repo.rootUri);
      void vscode.window.showInformationMessage('Merge/Rebase aborted.');
    }, 'Abort Merge/Rebase');
  });

  register('gitcc.openWorktree', async (item?: WorktreeTreeItem) => {
    if (!item) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(item.worktree.path), true);
  });

  register('gitcc.pruneWorktrees', async () => {
    await withRepo(async (repo) => {
      const choice = await vscode.window.showWarningMessage('Prune stale worktrees?', 'Prune');
      if (choice !== 'Prune') {
        return;
      }
      await deps.gitService.pruneWorktrees(repo.rootUri);
    }, 'Prune Worktrees');
  });

  register('gitcc.createWorktree', async () => {
    await withRepo(async (repo) => {
      const branch = await vscode.window.showInputBox({ prompt: 'Branch name for worktree' });
      if (!branch) {
        return;
      }
      const targetPath = await vscode.window.showInputBox({
        prompt: 'Target worktree path',
        value: path.join(path.dirname(repo.rootUri.fsPath), `${path.basename(repo.rootUri.fsPath)}-${branch.replace(/\//g, '-')}`),
      });
      if (!targetPath) {
        return;
      }
      await deps.gitService.createWorktree(repo.rootUri, targetPath, branch);
    }, 'Create Worktree');
  });
}

async function refreshAll(deps: Deps, providers: Providers, force = false): Promise<void> {
  await deps.repositoryManager.refreshRepositories(force);
  await Promise.all([
    providers.branchesProvider.refresh(),
    providers.changesProvider.refresh(),
    providers.stashProvider.refresh(),
    providers.miniLogProvider.refresh(),
    providers.worktreesProvider.refresh(),
  ]);

  providers.repositoriesProvider.refresh();

  const repo = deps.repositoryManager.getActiveRepository();
  if (repo) {
    const status = await deps.gitService.getStatus(repo.rootUri);
    providers.commitViewProvider.updateStatus(status);
  }
}

async function runErrorAction(action: string | undefined, deps: Deps, repoUri: vscode.Uri): Promise<void> {
  if (!action) {
    return;
  }
  if (action === 'Set Upstream') {
    await vscode.commands.executeCommand('gitcc.setUpstream');
    return;
  }
  if (action === 'Smart Checkout') {
    await vscode.commands.executeCommand('gitcc.smartCheckout');
    return;
  }
  if (action === 'Pull then Push') {
    await deps.gitService.pull(repoUri, deps.configService.get().pullRebase, deps.configService.get().defaultRemote);
    await deps.gitService.push(repoUri, deps.configService.get().defaultRemote);
    return;
  }
  if (action === 'Force with Lease') {
    await vscode.commands.executeCommand('gitcc.forcePushWithLease');
  }
}

async function pickBranch(
  gitService: GitService,
  repoUri: vscode.Uri,
  currentBranch: string,
  placeholder: string,
): Promise<BranchInfo | undefined> {
  const branches = await gitService.getBranches(repoUri, currentBranch);
  const selected = await vscode.window.showQuickPick(
    branches.map((branch) => ({
      label: branch.shortName,
      description: branch.kind,
      detail: branch.isCurrent ? 'current' : branch.upstream,
      branch,
    })),
    { placeHolder: placeholder },
  );

  return selected?.branch;
}

async function pickStash(stashes: StashEntry[], placeholder: string): Promise<StashEntry | undefined> {
  const selected = await vscode.window.showQuickPick(
    stashes.map((stash) => ({ label: stash.ref, description: stash.message, stash })),
    { placeHolder: placeholder },
  );

  return selected?.stash;
}

async function resolveFileChange(
  change: FileChange | undefined,
  provider: ChangesProvider,
  preferredSection?: FileChange['section'],
): Promise<FileChange | undefined> {
  if (change) {
    return change;
  }

  const rootNodes = provider.getChildren();
  const candidates: FileChange[] = [];

  for (const root of rootNodes) {
    const children = provider.getChildren(root);
    for (const child of children) {
      if (child instanceof vscode.TreeItem && 'change' in child) {
        const candidate = (child as unknown as { change: FileChange }).change;
        if (!preferredSection || candidate.section === preferredSection) {
          candidates.push(candidate);
        }
      }
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    candidates.map((item) => ({ label: item.path, description: item.section, item })),
    { placeHolder: 'Select file' },
  );

  return selected?.item;
}

async function openComparePanel(
  gitService: GitService,
  repoUri: vscode.Uri,
  left: string,
  right: string,
): Promise<void> {
  const data = await gitService.compareBranches(repoUri, left, right);
  const diffSummary = await gitService.getDiffSummary(repoUri, left, right);
  const panel = vscode.window.createWebviewPanel(
    'gitcc.compare',
    `Compare ${left} ↔ ${right}`,
    vscode.ViewColumn.Active,
    { enableScripts: false },
  );

  const leftRows = data.leftOnly
    .map((entry) => `<li><code>${entry.shortHash}</code> ${escapeHtml(entry.subject)} <em>${escapeHtml(entry.relativeDate)}</em></li>`)
    .join('');
  const rightRows = data.rightOnly
    .map((entry) => `<li><code>${entry.shortHash}</code> ${escapeHtml(entry.subject)} <em>${escapeHtml(entry.relativeDate)}</em></li>`)
    .join('');

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
ul { margin: 0; padding-left: 18px; }
code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; }
pre { background: var(--vscode-textCodeBlock-background); padding: 8px; overflow-x: auto; }
</style>
</head>
<body>
<h3>${escapeHtml(left)} vs ${escapeHtml(right)}</h3>
<p>Ahead/Behind: <strong>${data.ahead}</strong> / <strong>${data.behind}</strong></p>
<h4>Tip Diff Summary</h4>
<pre>${escapeHtml(diffSummary || 'No file-level differences.')}</pre>
<div class="grid">
  <div>
    <h4>${escapeHtml(left)} only</h4>
    <ul>${leftRows || '<li>No unique commits</li>'}</ul>
  </div>
  <div>
    <h4>${escapeHtml(right)} only</h4>
    <ul>${rightRows || '<li>No unique commits</li>'}</ul>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
