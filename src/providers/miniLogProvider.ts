import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { RepositoryManager } from '../services/repositoryManager';
import { MiniLogEntry } from '../types/git';
import { GroupTreeItem } from '../ui/treeItems';

class CommitTreeItem extends vscode.TreeItem {
  constructor(public readonly commit: MiniLogEntry) {
    super(`${commit.subject || '(no subject)'}`, vscode.TreeItemCollapsibleState.None);
    this.description = `${commit.shortHash} • ${commit.author} • ${commit.relativeDate}`;
    this.contextValue = 'gitcc.commit';
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.command = {
      command: 'gitcc.openCommitDetails',
      title: 'Open Commit Details',
      arguments: [commit],
    };
  }
}

type LogNode = GroupTreeItem | CommitTreeItem;

export class MiniLogProvider implements vscode.TreeDataProvider<LogNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private commits: MiniLogEntry[] = [];

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
    this.commits = repo ? await this.gitService.getMiniLog(repo.rootUri, 'HEAD', 20) : [];
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: LogNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LogNode): LogNode[] {
    if (!element) {
      return [new GroupTreeItem('Recent Commits', 'gitcc.group.log')];
    }
    if (element instanceof GroupTreeItem) {
      return this.commits.map((commit) => new CommitTreeItem(commit));
    }
    return [];
  }
}
