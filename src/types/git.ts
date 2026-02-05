import type * as vscode from 'vscode';

export type BranchKind = 'local' | 'remote';
export type ChangeSection = 'staged' | 'unstaged' | 'untracked' | 'conflicts';

export interface RepositoryInfo {
  id: string;
  rootUri: vscode.Uri;
  name: string;
  currentBranch: string;
  detachedHead: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  dirtyCount: number;
  hasSubmodules: boolean;
}

export interface BranchInfo {
  name: string;
  shortName: string;
  kind: BranchKind;
  remoteName?: string;
  isCurrent: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  merged: boolean;
  stale: boolean;
  lastCommitEpochSeconds?: number;
}

export interface FileChange {
  path: string;
  originalPath?: string;
  section: ChangeSection;
  x: string;
  y: string;
}

export interface StatusInfo {
  branch: string;
  detachedHead: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  conflicts: FileChange[];
}

export interface StashEntry {
  ref: string;
  index: number;
  branch?: string;
  message: string;
  date?: string;
  baseCommit?: string;
}

export interface CommitOptions {
  amend?: boolean;
  signoff?: boolean;
  sign?: boolean;
  noVerify?: boolean;
  pushAfter?: boolean;
  syncAfter?: boolean;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  prunable?: string;
}

export interface MiniLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  relativeDate: string;
  subject: string;
}
