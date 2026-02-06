import * as vscode from 'vscode';
import { BranchInfo } from '../types/git';
import { GitService } from '../services/gitService';
import { RepositoryManager } from '../services/repositoryManager';
import { ConfigService } from '../services/configService';
import { BranchTreeItem, GroupTreeItem } from '../ui/treeItems';

type BranchNode = GroupTreeItem | BranchTreeItem;

export class BranchesProvider implements vscode.TreeDataProvider<BranchNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private localByGroup = new Map<string, BranchInfo[]>();
  private remoteByGroup = new Map<string, BranchInfo[]>();

  constructor(
    private readonly gitService: GitService,
    private readonly repositoryManager: RepositoryManager,
    private readonly configService: ConfigService,
  ) {
    this.repositoryManager.onDidChangeRepositories(() => {
      void this.refresh();
    });
  }

  async refresh(): Promise<void> {
    const repo = this.repositoryManager.getActiveRepository();
    if (!repo) {
      this.localByGroup.clear();
      this.remoteByGroup.clear();
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    const branches = await this.gitService.getBranches(repo.rootUri, repo.currentBranch);
    const config = this.configService.get();
    const locals = branches.filter((b) => b.kind === 'local');
    const remotes = branches.filter((b) => b.kind === 'remote');
    this.localByGroup = this.groupLocal(locals, config.branchGroupingPrefixes);
    this.remoteByGroup = this.groupRemote(remotes);

    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: BranchNode): vscode.TreeItem {
    if (element instanceof BranchTreeItem) {
      element.contextValue = element.branch.kind === 'remote' ? 'gitcc.branch.remote' : 'gitcc.branch.local';
      element.command = {
        title: 'Checkout Branch',
        command: 'gitcc.checkoutBranch',
        arguments: [element.branch],
      };
      element.tooltip = new vscode.MarkdownString(
        `${element.branch.name}\n\n${element.branch.upstream ? `upstream: ${element.branch.upstream}` : 'no upstream configured'}`,
      );
    }
    return element;
  }

  getChildren(element?: BranchNode): BranchNode[] {
    if (!element) {
      const roots: BranchNode[] = [
        new GroupTreeItem('LOCAL', 'gitcc.group.local', vscode.TreeItemCollapsibleState.Expanded),
      ];
      if (this.configService.get().showRemoteBranches) {
        roots.push(new GroupTreeItem('REMOTE', 'gitcc.group.remote', vscode.TreeItemCollapsibleState.Expanded));
      }
      return roots;
    }

    if (element instanceof GroupTreeItem && element.groupLabel === 'LOCAL') {
      return [...this.localByGroup.keys()].map(
        (group) =>
          new GroupTreeItem(
            group,
            `gitcc.group.local.${group}`,
            vscode.TreeItemCollapsibleState.Expanded,
          ),
      );
    }

    if (element instanceof GroupTreeItem && element.groupLabel === 'REMOTE') {
      return [...this.remoteByGroup.keys()].map(
        (group) =>
          new GroupTreeItem(
            group,
            `gitcc.group.remote.${group}`,
            vscode.TreeItemCollapsibleState.Expanded,
          ),
      );
    }

    if (element instanceof GroupTreeItem && element.contextValueKey.startsWith('gitcc.group.local.')) {
      const group = element.groupLabel;
      return (this.localByGroup.get(group) ?? []).map((branch) => new BranchTreeItem(branch));
    }

    if (element instanceof GroupTreeItem && element.contextValueKey.startsWith('gitcc.group.remote.')) {
      const group = element.groupLabel;
      return (this.remoteByGroup.get(group) ?? []).map((branch) => new BranchTreeItem(branch));
    }

    return [];
  }

  private groupLocal(branches: BranchInfo[], prefixes: string[]): Map<string, BranchInfo[]> {
    const map = new Map<string, BranchInfo[]>();
    for (const branch of branches) {
      const foundPrefix = prefixes.find((prefix) => branch.shortName.startsWith(prefix));
      const group = foundPrefix ? foundPrefix.replace('/', '') : 'other';
      const list = map.get(group) ?? [];
      list.push(branch);
      map.set(group, list);
    }

    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  private groupRemote(branches: BranchInfo[]): Map<string, BranchInfo[]> {
    const map = new Map<string, BranchInfo[]>();
    for (const branch of branches) {
      const group = branch.remoteName ?? 'unknown';
      const list = map.get(group) ?? [];
      list.push(branch);
      map.set(group, list);
    }

    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
