import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RepositoryManager } from '../services/repositoryManager';
import { WorktreeInfo } from '../types/git';

export class WorktreeTreeItem extends vscode.TreeItem {
  constructor(public readonly worktree: WorktreeInfo) {
    super(worktree.path, vscode.TreeItemCollapsibleState.None);
    this.description = worktree.detached ? 'detached' : worktree.branch ?? worktree.head.slice(0, 8);
    this.contextValue = 'gitcc.worktree';
    this.tooltip = `${worktree.path}\nHEAD: ${worktree.head}${worktree.prunable ? `\nprunable: ${worktree.prunable}` : ''}`;
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

export class WorktreesProvider implements vscode.TreeDataProvider<WorktreeTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private items: WorktreeTreeItem[] = [];

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
    this.items = repo
      ? (await this.gitService.getWorktrees(repo.rootUri)).map((wt) => new WorktreeTreeItem(wt))
      : [];
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: WorktreeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): WorktreeTreeItem[] {
    return this.items;
  }
}
