import * as vscode from 'vscode';
import { RepositoryManager } from '../services/repositoryManager';
import { RepositoryTreeItem } from '../ui/treeItems';

export class RepositoriesProvider implements vscode.TreeDataProvider<RepositoryTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly repositoryManager: RepositoryManager) {
    this.repositoryManager.onDidChangeRepositories(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: RepositoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): RepositoryTreeItem[] {
    const active = this.repositoryManager.getActiveRepository();
    return this.repositoryManager
      .getRepositories()
      .map((repo) => new RepositoryTreeItem(repo, active?.id === repo.id));
  }
}
