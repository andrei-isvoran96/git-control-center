import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RepositoryManager } from '../services/repositoryManager';
import { StashTreeItem } from '../ui/treeItems';

export class StashProvider implements vscode.TreeDataProvider<StashTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private items: StashTreeItem[] = [];

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
    if (!repo) {
      this.items = [];
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    const stashes = await this.gitService.getStashes(repo.rootUri);
    this.items = stashes.map((stash) => new StashTreeItem(stash));
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: StashTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): StashTreeItem[] {
    return this.items;
  }
}
