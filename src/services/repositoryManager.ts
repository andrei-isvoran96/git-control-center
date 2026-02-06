import * as vscode from 'vscode';
import { RepositoryInfo } from '../types/git';
import { GitService } from './gitService';
import { StateStore } from '../state/stateStore';

export class RepositoryManager implements vscode.Disposable {
  private readonly onDidChangeRepositoriesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeRepositories = this.onDidChangeRepositoriesEmitter.event;

  private activeRepositoryId?: string;
  private repositories: RepositoryInfo[] = [];
  private readonly cache = new StateStore<RepositoryInfo>();

  constructor(private readonly gitService: GitService) {}

  getRepositories(): RepositoryInfo[] {
    return this.repositories;
  }

  getActiveRepository(): RepositoryInfo | undefined {
    if (!this.activeRepositoryId) {
      return this.repositories[0];
    }
    return this.repositories.find((repo) => repo.id === this.activeRepositoryId) ?? this.repositories[0];
  }

  setActiveRepository(repositoryId: string): void {
    this.activeRepositoryId = repositoryId;
    this.onDidChangeRepositoriesEmitter.fire();
  }

  setActiveRepositoryForUri(uri: vscode.Uri): boolean {
    const targetPath = uri.fsPath;
    const matches = this.repositories
      .filter((repo) => targetPath === repo.rootUri.fsPath || targetPath.startsWith(`${repo.rootUri.fsPath}${pathSeparator()}`))
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length);

    const match = matches[0];
    if (!match || this.activeRepositoryId === match.id) {
      return false;
    }

    this.activeRepositoryId = match.id;
    this.onDidChangeRepositoriesEmitter.fire();
    return true;
  }

  async refreshRepositories(force = false): Promise<void> {
    const found = await this.gitService.detectRepositories();
    const next: RepositoryInfo[] = [];

    for (const repoUri of found) {
      const key = repoUri.toString();
      if (!force && this.cache.isFresh(key, 3000)) {
        const cached = this.cache.get(key);
        if (cached) {
          next.push(cached);
          continue;
        }
      }

      const info = await this.gitService.getRepositoryInfo(repoUri);
      this.cache.set(key, info);
      next.push(info);
    }

    this.repositories = next;
    if (!this.activeRepositoryId && next.length > 0) {
      this.activeRepositoryId = next[0].id;
    } else if (this.activeRepositoryId && !next.some((r) => r.id === this.activeRepositoryId)) {
      this.activeRepositoryId = next[0]?.id;
    }

    this.onDidChangeRepositoriesEmitter.fire();
  }

  invalidate(repositoryId?: string): void {
    if (repositoryId) {
      this.cache.invalidate(repositoryId);
    } else {
      this.cache.invalidate();
    }
  }

  dispose(): void {
    this.onDidChangeRepositoriesEmitter.dispose();
  }
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/';
}
