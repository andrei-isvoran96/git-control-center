import * as vscode from 'vscode';
import { BranchesProvider } from '../providers/branchesProvider';
import { ChangesProvider } from '../providers/changesProvider';
import { RepositoriesProvider } from '../providers/repositoriesProvider';
import { StashProvider } from '../providers/stashProvider';
import { Debouncer } from '../utils/debounce';
import { ConfigService } from './configService';
import { RepositoryManager } from './repositoryManager';

interface Providers {
  repositoriesProvider: RepositoriesProvider;
  branchesProvider: BranchesProvider;
  changesProvider: ChangesProvider;
  stashProvider: StashProvider;
  extraRefreshers?: Array<{ refresh: () => Promise<void> | void }>;
}

export class RefreshOrchestrator implements vscode.Disposable {
  private readonly debouncer = new Debouncer();
  private intervalHandle?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly repositoryManager: RepositoryManager,
    private readonly providers: Providers,
    private readonly configService: ConfigService,
  ) {}

  start(): void {
    this.scheduleInterval();

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => this.triggerDebounced()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.triggerDebounced()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitcc')) {
          this.scheduleInterval();
          this.triggerDebounced();
        }
      }),
    );

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      const gitApiProvider = gitExtension.isActive ? gitExtension.exports : undefined;
      if (gitApiProvider?.getAPI) {
        const gitApi = gitApiProvider.getAPI(1) as {
          onDidOpenRepository?: vscode.Event<unknown>;
          onDidCloseRepository?: vscode.Event<unknown>;
        };
        if (gitApi.onDidOpenRepository) {
          this.disposables.push(gitApi.onDidOpenRepository(() => this.triggerDebounced()));
        }
        if (gitApi.onDidCloseRepository) {
          this.disposables.push(gitApi.onDidCloseRepository(() => this.triggerDebounced()));
        }
      }
    }

    void this.refreshNow(true);
  }

  triggerDebounced(): void {
    this.debouncer.trigger(() => {
      void this.refreshNow();
    }, 400);
  }

  private async refreshNow(force = false): Promise<void> {
    await this.repositoryManager.refreshRepositories(force);
    await Promise.all([
      this.providers.branchesProvider.refresh(),
      this.providers.changesProvider.refresh(),
      this.providers.stashProvider.refresh(),
      ...(this.providers.extraRefreshers?.map((provider) => provider.refresh()) ?? []),
    ]);
    this.providers.repositoriesProvider.refresh();
  }

  private scheduleInterval(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    const seconds = this.configService.get().refreshIntervalSeconds;
    this.intervalHandle = setInterval(() => {
      void this.refreshNow();
    }, seconds * 1000);
  }

  dispose(): void {
    this.debouncer.clear();
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    this.disposables.forEach((d) => d.dispose());
  }
}
