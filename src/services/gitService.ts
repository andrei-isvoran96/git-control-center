import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { promisify } from 'node:util';
import { parseBranchRefs, parseMiniLog, parseStashList, parseStatusPorcelainV2, parseWorktrees } from '../domain/parsers';
import { GitCcError } from './errorReporter';
import { BranchInfo, CommitOptions, MiniLogEntry, RepositoryInfo, StashEntry, StatusInfo, WorktreeInfo } from '../types/git';

const execFileAsync = promisify(execFile);

export class GitService {
  private readonly gitBinary = 'git';
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  async isGitAvailable(): Promise<boolean> {
    try {
      await this.runGitRaw([], ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async detectRepositories(): Promise<vscode.Uri[]> {
    const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [];
    const repositoryUris = new Map<string, vscode.Uri>();

    for (const root of roots) {
      const topLevel = await this.getTopLevel(root.fsPath);
      if (topLevel) {
        repositoryUris.set(topLevel, vscode.Uri.file(topLevel));
      }

      const gitEntries = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, '**/.git'),
        '**/node_modules/**',
        100,
      );

      for (const entry of gitEntries) {
        const repoRoot = path.dirname(entry.fsPath);
        repositoryUris.set(repoRoot, vscode.Uri.file(repoRoot));
      }
    }

    return [...repositoryUris.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  async getRepositoryInfo(repoUri: vscode.Uri): Promise<RepositoryInfo> {
    const status = await this.getStatus(repoUri);
    const hasSubmodules = await this.hasSubmodules(repoUri);
    const dirtyCount =
      status.staged.length + status.unstaged.length + status.untracked.length + status.conflicts.length;

    return {
      id: repoUri.toString(),
      rootUri: repoUri,
      name: path.basename(repoUri.fsPath),
      currentBranch: status.branch,
      detachedHead: status.detachedHead,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      dirtyCount,
      hasSubmodules,
    };
  }

  async getStatus(repoUri: vscode.Uri): Promise<StatusInfo> {
    const output = await this.runGit(repoUri.fsPath, ['status', '--porcelain=v2', '-b']);
    return parseStatusPorcelainV2(output);
  }

  async getBranches(repoUri: vscode.Uri, currentBranch?: string): Promise<BranchInfo[]> {
    const key = `branches:${repoUri.toString()}:${currentBranch ?? ''}`;
    const cached = this.getCached<BranchInfo[]>(key, 3000);
    if (cached) {
      return cached;
    }
    const output = await this.runGit(repoUri.fsPath, [
      'for-each-ref',
      '--format=%(refname)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:unix)',
      'refs/heads',
      'refs/remotes',
    ]);
    const value = parseBranchRefs(output, currentBranch);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async getStashes(repoUri: vscode.Uri): Promise<StashEntry[]> {
    const output = await this.runGit(repoUri.fsPath, ['stash', 'list', '--date=relative']);
    return parseStashList(output);
  }

  async fetch(repoUri: vscode.Uri, remote?: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['fetch', '--prune', ...(remote ? [remote] : [])]);
  }

  async pull(repoUri: vscode.Uri, rebase: boolean, remote?: string): Promise<void> {
    const args = ['pull'];
    if (rebase) {
      args.push('--rebase');
    }
    if (remote) {
      args.push(remote);
    }
    await this.runGit(repoUri.fsPath, args);
  }

  async push(repoUri: vscode.Uri, remote?: string, forceWithLease = false): Promise<void> {
    const args = ['push'];
    if (forceWithLease) {
      args.push('--force-with-lease');
    }
    if (remote) {
      args.push(remote);
    }
    await this.runGit(repoUri.fsPath, args);
  }

  async checkoutBranch(repoUri: vscode.Uri, branchName: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['checkout', branchName]);
  }

  async createBranch(repoUri: vscode.Uri, branchName: string, checkout: boolean): Promise<void> {
    const args = checkout ? ['checkout', '-b', branchName] : ['branch', branchName];
    await this.runGit(repoUri.fsPath, args);
  }

  async createBranchFrom(repoUri: vscode.Uri, branchName: string, fromRef: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['checkout', '-b', branchName, fromRef]);
  }

  async renameBranch(repoUri: vscode.Uri, oldName: string, newName: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['branch', '-m', oldName, newName]);
  }

  async deleteBranch(repoUri: vscode.Uri, branchName: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['branch', '-D', branchName]);
  }

  async mergeIntoCurrent(repoUri: vscode.Uri, branchName: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['merge', '--no-ff', branchName]);
  }

  async rebaseCurrentOnto(repoUri: vscode.Uri, branchName: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['rebase', branchName]);
  }

  async setUpstream(repoUri: vscode.Uri, branchName: string, upstream: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['branch', '--set-upstream-to', upstream, branchName]);
  }

  async compareWithCurrent(repoUri: vscode.Uri, branchName: string): Promise<string> {
    return this.runGit(repoUri.fsPath, ['log', '--oneline', '--decorate', `${branchName}..HEAD`]);
  }

  async compareBranches(
    repoUri: vscode.Uri,
    left: string,
    right: string,
  ): Promise<{ ahead: number; behind: number; leftOnly: MiniLogEntry[]; rightOnly: MiniLogEntry[] }> {
    const counts = await this.runGit(repoUri.fsPath, ['rev-list', '--left-right', '--count', `${left}...${right}`]);
    const [leftCountRaw, rightCountRaw] = counts.trim().split(/\s+/);
    const leftOnly = await this.getMiniLogForRange(repoUri, `${right}..${left}`, 20);
    const rightOnly = await this.getMiniLogForRange(repoUri, `${left}..${right}`, 20);
    return {
      ahead: Number(leftCountRaw ?? '0'),
      behind: Number(rightCountRaw ?? '0'),
      leftOnly,
      rightOnly,
    };
  }

  async getDiffSummary(repoUri: vscode.Uri, left: string, right: string): Promise<string> {
    return this.runGit(repoUri.fsPath, ['diff', '--stat', `${left}..${right}`]);
  }

  async viewLog(repoUri: vscode.Uri, scope?: string): Promise<string> {
    const args = ['log', '--oneline', '--decorate', '-n', '100'];
    if (scope) {
      args.push('--', scope);
    }
    return this.runGit(repoUri.fsPath, args);
  }

  async getMiniLog(repoUri: vscode.Uri, ref = 'HEAD', limit = 20): Promise<MiniLogEntry[]> {
    const key = `minilog:${repoUri.toString()}:${ref}:${limit}`;
    const cached = this.getCached<MiniLogEntry[]>(key, 4000);
    if (cached) {
      return cached;
    }
    const output = await this.runGit(repoUri.fsPath, [
      'log',
      ref,
      `-n`,
      String(limit),
      '--date=relative',
      '--pretty=format:%H\t%an\t%ar\t%s',
    ]);
    const value = parseMiniLog(output);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async getCommitDetails(repoUri: vscode.Uri, hash: string): Promise<string> {
    return this.runGit(repoUri.fsPath, ['show', '--stat', '--patch', '--decorate', hash]);
  }

  async checkoutCommit(repoUri: vscode.Uri, hash: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['checkout', hash]);
  }

  async getWorktrees(repoUri: vscode.Uri): Promise<WorktreeInfo[]> {
    const output = await this.runGit(repoUri.fsPath, ['worktree', 'list', '--porcelain']);
    return parseWorktrees(output);
  }

  async pruneWorktrees(repoUri: vscode.Uri): Promise<void> {
    await this.runGit(repoUri.fsPath, ['worktree', 'prune']);
  }

  async createWorktree(repoUri: vscode.Uri, targetPath: string, branchName: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['worktree', 'add', targetPath, branchName]);
  }

  async commit(repoUri: vscode.Uri, message: string, options: CommitOptions): Promise<void> {
    const args = ['commit', '-m', message];
    if (options.amend) {
      args.push('--amend');
    }
    if (options.signoff) {
      args.push('--signoff');
    }
    if (options.sign) {
      args.push('-S');
    }
    if (options.noVerify) {
      args.push('--no-verify');
    }
    await this.runGit(repoUri.fsPath, args);
  }

  async stageFile(repoUri: vscode.Uri, filePath: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['add', '--', filePath]);
  }

  async unstageFile(repoUri: vscode.Uri, filePath: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['restore', '--staged', '--', filePath]);
  }

  async stageAll(repoUri: vscode.Uri): Promise<void> {
    await this.runGit(repoUri.fsPath, ['add', '-A']);
  }

  async unstageAll(repoUri: vscode.Uri): Promise<void> {
    await this.runGit(repoUri.fsPath, ['restore', '--staged', '.']);
  }

  async discardFile(repoUri: vscode.Uri, filePath: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['restore', '--', filePath]);
  }

  async discardAll(repoUri: vscode.Uri): Promise<void> {
    await this.runGit(repoUri.fsPath, ['restore', '--worktree', '--', '.']);
    await this.runGit(repoUri.fsPath, ['clean', '-fd']);
  }

  async stageHunk(repoUri: vscode.Uri, filePath: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['add', '--patch', '--', filePath]);
  }

  async stash(repoUri: vscode.Uri, message?: string, keepIndex = false): Promise<void> {
    const args = ['stash', 'push'];
    if (keepIndex) {
      args.push('--keep-index');
    }
    if (message) {
      args.push('-m', message);
    }
    await this.runGit(repoUri.fsPath, args);
  }

  async hasConflicts(repoUri: vscode.Uri): Promise<boolean> {
    const status = await this.getStatus(repoUri);
    return status.conflicts.length > 0;
  }

  async hasMergeInProgress(repoUri: vscode.Uri): Promise<boolean> {
    try {
      const mergeHead = path.join(repoUri.fsPath, '.git', 'MERGE_HEAD');
      await fs.access(mergeHead);
      return true;
    } catch {
      return false;
    }
  }

  async stashApply(repoUri: vscode.Uri, ref: string, pop: boolean): Promise<void> {
    await this.runGit(repoUri.fsPath, ['stash', pop ? 'pop' : 'apply', ref]);
  }

  async stashDrop(repoUri: vscode.Uri, ref: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['stash', 'drop', ref]);
  }

  async stashBranch(repoUri: vscode.Uri, branchName: string, ref: string): Promise<void> {
    await this.runGit(repoUri.fsPath, ['stash', 'branch', branchName, ref]);
  }

  async stashShowPatch(repoUri: vscode.Uri, ref: string): Promise<string> {
    return this.runGit(repoUri.fsPath, ['stash', 'show', '-p', ref]);
  }

  async abortMergeOrRebase(repoUri: vscode.Uri): Promise<void> {
    try {
      await this.runGit(repoUri.fsPath, ['merge', '--abort']);
    } catch {
      await this.runGit(repoUri.fsPath, ['rebase', '--abort']);
    }
  }

  async openFileDiff(repoUri: vscode.Uri, filePath: string): Promise<void> {
    const left = vscode.Uri.file(path.join(repoUri.fsPath, filePath)).with({ scheme: 'git' });
    const right = vscode.Uri.file(path.join(repoUri.fsPath, filePath));
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${path.basename(filePath)} (HEAD ↔ Working Tree)`,
    );
  }

  private async hasSubmodules(repoUri: vscode.Uri): Promise<boolean> {
    try {
      await fs.access(path.join(repoUri.fsPath, '.gitmodules'));
      return true;
    } catch {
      return false;
    }
  }

  private async getTopLevel(repoPath: string): Promise<string | undefined> {
    try {
      const output = await this.runGit(repoPath, ['rev-parse', '--show-toplevel']);
      return output.trim();
    } catch {
      return undefined;
    }
  }

  private async runGit(cwd: string, args: string[]): Promise<string> {
    this.invalidateShallowCache(cwd, args);
    const result = await this.runGitRaw([`-C`, cwd], args);
    return result.stdout.trimEnd();
  }

  private async getMiniLogForRange(repoUri: vscode.Uri, range: string, limit: number): Promise<MiniLogEntry[]> {
    const output = await this.runGit(repoUri.fsPath, [
      'log',
      range,
      '-n',
      String(limit),
      '--date=relative',
      '--pretty=format:%H\t%an\t%ar\t%s',
    ]);
    return parseMiniLog(output);
  }

  private getCached<T>(key: string, ttlMs: number): T | undefined {
    const cached = this.cache.get(key);
    if (!cached) {
      return undefined;
    }
    if (Date.now() - cached.at > ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return cached.value as T;
  }

  private invalidateShallowCache(cwd: string, args: string[]): void {
    const writeCommands = new Set([
      'checkout',
      'commit',
      'merge',
      'rebase',
      'pull',
      'push',
      'branch',
      'stash',
      'restore',
      'add',
      'clean',
      'fetch',
      'worktree',
    ]);
    if (!writeCommands.has(args[0] ?? '')) {
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(cwd)) {
        this.cache.delete(key);
      }
    }
  }

  private async runGitRaw(prefixArgs: string[], args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync(this.gitBinary, [...prefixArgs, ...args], {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const failure = error as Error & { stderr?: string; code?: number | string };
      throw new GitCcError(
        failure.message,
        failure.stderr,
        typeof failure.code === 'number' ? failure.code : undefined,
      );
    }
  }
}
