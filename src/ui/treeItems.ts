import * as vscode from 'vscode';
import { BranchInfo, FileChange, RepositoryInfo, StashEntry } from '../types/git';
import { formatRelativeAge } from '../domain/parsers';

export class RepositoryTreeItem extends vscode.TreeItem {
  constructor(public readonly repository: RepositoryInfo, active: boolean) {
    super(repository.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'gitcc.repo';
    this.description = `${repository.currentBranch} ${repository.ahead || repository.behind ? `↑${repository.ahead} ↓${repository.behind}` : ''} ${repository.dirtyCount ? `•${repository.dirtyCount}` : ''}`.trim();
    this.tooltip = `${repository.rootUri.fsPath}${repository.hasSubmodules ? '\nContains submodules (read-only warning).' : ''}`;
    this.iconPath = new vscode.ThemeIcon(active ? 'target' : 'repo');
    this.command = {
      title: 'Switch Repository',
      command: 'gitcc.switchRepository',
      arguments: [repository],
    };
  }
}

export class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly groupLabel: string,
    public readonly contextValueKey: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(groupLabel, collapsibleState);
    this.contextValue = contextValueKey;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class BranchTreeItem extends vscode.TreeItem {
  constructor(public readonly branch: BranchInfo) {
    super(branch.shortName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'gitcc.branch';
    this.iconPath = new vscode.ThemeIcon('git-branch');
    this.description = [
      branch.isCurrent ? 'current' : '',
      branch.ahead || branch.behind ? `↑${branch.ahead} ↓${branch.behind}` : '',
      branch.merged ? 'merged' : '',
      branch.stale ? 'stale' : '',
      `age:${formatRelativeAge(branch.lastCommitEpochSeconds)}`,
    ]
      .filter(Boolean)
      .join(' • ');
    this.tooltip = `${branch.name}${branch.upstream ? `\nupstream: ${branch.upstream}` : '\nno upstream configured'}`;
    this.command = {
      title: 'Checkout Branch',
      command: 'gitcc.checkoutBranch',
      arguments: [branch],
    };
  }
}

export class ChangeFileTreeItem extends vscode.TreeItem {
  constructor(public readonly change: FileChange) {
    super(change.path, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `gitcc.file.${change.section}`;
    this.description = `${change.x}${change.y}`;
    this.iconPath = new vscode.ThemeIcon(this.resolveIcon());
    this.command = {
      title: 'Open Diff',
      command: 'gitcc.openDiff',
      arguments: [change],
    };
  }

  private resolveIcon(): string {
    if (this.change.section === 'conflicts') {
      return 'warning';
    }
    if (this.change.section === 'staged') {
      return 'pass';
    }
    if (this.change.section === 'untracked') {
      return 'question';
    }
    return 'diff';
  }
}

export class StashTreeItem extends vscode.TreeItem {
  constructor(public readonly stash: StashEntry) {
    super(stash.ref, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'gitcc.stash';
    this.description = stash.message;
    this.tooltip = `${stash.ref}${stash.branch ? ` on ${stash.branch}` : ''}`;
    this.iconPath = new vscode.ThemeIcon('archive');
  }
}
