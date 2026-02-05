import * as vscode from 'vscode';

interface RepoBranchMemory {
  favorites: string[];
  recents: string[];
}

export class BranchMemoryService {
  constructor(private readonly workspaceState: vscode.Memento) {}

  async pin(repoKey: string, branchName: string): Promise<void> {
    const memory = this.get(repoKey);
    if (!memory.favorites.includes(branchName)) {
      memory.favorites.unshift(branchName);
      memory.favorites = memory.favorites.slice(0, 50);
      await this.save(repoKey, memory);
    }
  }

  async unpin(repoKey: string, branchName: string): Promise<void> {
    const memory = this.get(repoKey);
    memory.favorites = memory.favorites.filter((name) => name !== branchName);
    await this.save(repoKey, memory);
  }

  async recordCheckout(repoKey: string, branchName: string): Promise<void> {
    const memory = this.get(repoKey);
    memory.recents = [branchName, ...memory.recents.filter((name) => name !== branchName)].slice(0, 10);
    await this.save(repoKey, memory);
  }

  getFavorites(repoKey: string): string[] {
    return this.get(repoKey).favorites;
  }

  getRecents(repoKey: string): string[] {
    return this.get(repoKey).recents;
  }

  isFavorite(repoKey: string, branchName: string): boolean {
    return this.getFavorites(repoKey).includes(branchName);
  }

  private key(repoKey: string): string {
    return `gitcc.branchMemory:${repoKey}`;
  }

  private get(repoKey: string): RepoBranchMemory {
    return this.workspaceState.get<RepoBranchMemory>(this.key(repoKey), {
      favorites: [],
      recents: [],
    });
  }

  private async save(repoKey: string, memory: RepoBranchMemory): Promise<void> {
    await this.workspaceState.update(this.key(repoKey), memory);
  }
}
