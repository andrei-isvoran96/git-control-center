import * as vscode from 'vscode';
import { RepositoryManager } from '../services/repositoryManager';

export class StatusBarController implements vscode.Disposable {
  private readonly branchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  private readonly syncItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 19);

  constructor(private readonly repositoryManager: RepositoryManager) {
    this.branchItem.command = 'gitcc.openGitDashboard';
    this.branchItem.tooltip = 'Open Git Control Center Branches';
    this.syncItem.command = 'gitcc.sync';
    this.syncItem.tooltip = 'One-Click Sync (fetch/pull/push)';
    this.repositoryManager.onDidChangeRepositories(() => this.refresh());
  }

  refresh(): void {
    const repo = this.repositoryManager.getActiveRepository();
    if (!repo) {
      this.branchItem.hide();
      this.syncItem.hide();
      return;
    }

    this.branchItem.text = `$(git-branch) ${repo.name}:${repo.currentBranch} ↑${repo.ahead} ↓${repo.behind} •${repo.dirtyCount}`;
    this.syncItem.text = '$(sync) Sync';
    this.branchItem.show();
    this.syncItem.show();
  }

  dispose(): void {
    this.branchItem.dispose();
    this.syncItem.dispose();
  }
}
