import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RepositoryManager } from '../services/repositoryManager';
import { ChangeFileTreeItem, GroupTreeItem } from '../ui/treeItems';
import { StatusInfo } from '../types/git';

type ChangeNode = GroupTreeItem | ChangeFileTreeItem;

export class ChangesProvider implements vscode.TreeDataProvider<ChangeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private status?: StatusInfo;

  constructor(
    private readonly gitService: GitService,
    private readonly repositoryManager: RepositoryManager,
  ) {
    this.repositoryManager.onDidChangeRepositories(() => {
      void this.refresh();
    });
  }

  async refresh(): Promise<void> {
    const repo = this.repositoryManager.getActiveRepository();
    this.status = repo ? await this.gitService.getStatus(repo.rootUri) : undefined;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: ChangeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ChangeNode): ChangeNode[] {
    if (!this.status) {
      return [];
    }

    if (!element) {
      return [
        new GroupTreeItem(
          `Staged${this.status.staged.length ? ` ${this.status.staged.length}` : ''}`,
          'gitcc.group.staged',
          vscode.TreeItemCollapsibleState.Expanded,
        ),
        new GroupTreeItem(
          `Unstaged${this.status.unstaged.length ? ` ${this.status.unstaged.length}` : ''}`,
          'gitcc.group.unstaged',
          vscode.TreeItemCollapsibleState.Collapsed,
        ),
        new GroupTreeItem(
          `Unversioned Files${this.status.untracked.length ? ` ${this.status.untracked.length}` : ''}`,
          'gitcc.group.untracked',
          vscode.TreeItemCollapsibleState.Collapsed,
        ),
        new GroupTreeItem(
          `Conflicts${this.status.conflicts.length ? ` ${this.status.conflicts.length}` : ''}`,
          'gitcc.group.conflicts',
          vscode.TreeItemCollapsibleState.Collapsed,
        ),
      ];
    }

    if (!(element instanceof GroupTreeItem)) {
      return [];
    }

    if (element.contextValueKey === 'gitcc.group.staged') {
      return this.status.staged.map((change) => new ChangeFileTreeItem(change));
    }
    if (element.contextValueKey === 'gitcc.group.unstaged') {
      return this.status.unstaged.map((change) => new ChangeFileTreeItem(change));
    }
    if (element.contextValueKey === 'gitcc.group.untracked') {
      return this.status.untracked.map((change) => new ChangeFileTreeItem(change));
    }
    if (element.contextValueKey === 'gitcc.group.conflicts') {
      return this.status.conflicts.map((change) => new ChangeFileTreeItem(change));
    }

    return [];
  }
}
