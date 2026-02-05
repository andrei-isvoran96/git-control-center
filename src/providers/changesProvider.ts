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
        new GroupTreeItem('Staged', 'gitcc.group.staged'),
        new GroupTreeItem('Unstaged', 'gitcc.group.unstaged'),
        new GroupTreeItem('Untracked', 'gitcc.group.untracked'),
        new GroupTreeItem('Conflicts', 'gitcc.group.conflicts'),
      ];
    }

    if (!(element instanceof GroupTreeItem)) {
      return [];
    }

    if (element.groupLabel === 'Staged') {
      return this.status.staged.map((change) => new ChangeFileTreeItem(change));
    }
    if (element.groupLabel === 'Unstaged') {
      return this.status.unstaged.map((change) => new ChangeFileTreeItem(change));
    }
    if (element.groupLabel === 'Untracked') {
      return this.status.untracked.map((change) => new ChangeFileTreeItem(change));
    }
    if (element.groupLabel === 'Conflicts') {
      return this.status.conflicts.map((change) => new ChangeFileTreeItem(change));
    }

    return [];
  }
}
