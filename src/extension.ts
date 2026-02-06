import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { BranchesProvider } from './providers/branchesProvider';
import { ChangesProvider } from './providers/changesProvider';
import { CommitViewProvider } from './providers/commitViewProvider';
import { MiniLogProvider } from './providers/miniLogProvider';
import { RepositoriesProvider } from './providers/repositoriesProvider';
import { StashProvider } from './providers/stashProvider';
import { WorktreesProvider } from './providers/worktreesProvider';
import { BranchMemoryService } from './services/branchMemoryService';
import { ConfigService } from './services/configService';
import { ErrorReporter } from './services/errorReporter';
import { GitService } from './services/gitService';
import { RefreshOrchestrator } from './services/refreshOrchestrator';
import { RepositoryManager } from './services/repositoryManager';
import { StatusBarController } from './ui/statusBarController';
import { Debouncer } from './utils/debounce';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const configService = new ConfigService();
  const errorReporter = new ErrorReporter();
  const gitService = new GitService();
  const branchMemoryService = new BranchMemoryService(context.workspaceState);

  if (!(await gitService.isGitAvailable())) {
    void vscode.window.showWarningMessage(
      'Git Control Center: Git binary was not found in PATH. Install Git to enable features.',
    );
    return;
  }

  const repositoryManager = new RepositoryManager(gitService);
  const repositoriesProvider = new RepositoriesProvider(repositoryManager);
  const branchesProvider = new BranchesProvider(gitService, repositoryManager, configService);
  const changesProvider = new ChangesProvider(gitService, repositoryManager);
  const stashProvider = new StashProvider(gitService, repositoryManager);
  const worktreesProvider = new WorktreesProvider(gitService, repositoryManager);
  const miniLogProvider = new MiniLogProvider(gitService, repositoryManager);
  const commitViewProvider = new CommitViewProvider(configService.get().commitTemplate);

  const providers = {
    repositoriesProvider,
    branchesProvider,
    changesProvider,
    stashProvider,
    worktreesProvider,
    miniLogProvider,
    commitViewProvider,
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('gitcc.branches', branchesProvider),
    vscode.window.registerTreeDataProvider('gitcc.stash', stashProvider),
    vscode.window.registerTreeDataProvider('gitcc.worktrees', worktreesProvider),
    vscode.window.registerTreeDataProvider('gitcc.log', miniLogProvider),
    vscode.window.registerWebviewViewProvider('gitcc.commit', commitViewProvider),
    repositoryManager,
  );

  const statusBar = new StatusBarController(repositoryManager);
  context.subscriptions.push(statusBar);
  repositoryManager.onDidChangeRepositories(() => statusBar.refresh());

  registerCommands(
    context,
    { gitService, repositoryManager, configService, errorReporter, branchMemoryService },
    providers,
  );

  const commitStatusDebouncer = new Debouncer();
  const refreshCommitStatus = async (): Promise<void> => {
    const repo = repositoryManager.getActiveRepository();
    if (!repo) {
      return;
    }
    try {
      const status = await gitService.getStatus(repo.rootUri);
      commitViewProvider.updateStatus(status);
    } catch {
      // non-fatal UI refresh path
    }
  };
  const scheduleCommitStatusRefresh = () => {
    commitStatusDebouncer.trigger(() => {
      void refreshCommitStatus();
    }, 250);
  };

  const syncActiveRepoFromEditor = async (editor: vscode.TextEditor | undefined): Promise<void> => {
    const uri = editor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      return;
    }
    const changed = repositoryManager.setActiveRepositoryForUri(uri);
    if (changed) {
      await vscode.commands.executeCommand('gitcc.refresh');
    } else {
      scheduleCommitStatusRefresh();
    }
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void syncActiveRepoFromEditor(editor);
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      scheduleCommitStatusRefresh();
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      scheduleCommitStatusRefresh();
    }),
  );

  context.subscriptions.push(
    commitViewProvider.onCommit(async (request) => {
      await vscode.commands.executeCommand('gitcc.commitNow', request.message, request.options);
    }),
  );
  context.subscriptions.push(
    commitViewProvider.onToggleFile(async (request) => {
      await vscode.commands.executeCommand('gitcc.toggleCommitFile', request);
    }),
  );

  const refreshOrchestrator = new RefreshOrchestrator(repositoryManager, {
    repositoriesProvider,
    branchesProvider,
    changesProvider,
    stashProvider,
    extraRefreshers: [worktreesProvider, miniLogProvider],
  }, configService);
  refreshOrchestrator.start();
  context.subscriptions.push(refreshOrchestrator);
  repositoryManager.onDidChangeRepositories(() => {
    scheduleCommitStatusRefresh();
  });
  await syncActiveRepoFromEditor(vscode.window.activeTextEditor);
  await refreshCommitStatus();

  const activeRepo = repositoryManager.getActiveRepository();
  if (activeRepo?.hasSubmodules) {
    void vscode.window.showWarningMessage(
      `Repository ${activeRepo.name} has submodules. Submodule operations are currently read-only in Git Control Center.`,
    );
  }
}

export function deactivate(): void {
  // no-op
}
