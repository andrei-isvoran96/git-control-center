import { BranchInfo, FileChange, MiniLogEntry, StashEntry, StatusInfo, WorktreeInfo } from '../types/git';

function parseAheadBehind(metadata: string): { ahead: number; behind: number } {
  const ahead = Number(metadata.match(/ahead (\d+)/)?.[1] ?? '0');
  const behind = Number(metadata.match(/behind (\d+)/)?.[1] ?? '0');
  return { ahead, behind };
}

export function parseStatusPorcelainV2(output: string): StatusInfo {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let branch = 'HEAD';
  let detachedHead = false;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;

  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: FileChange[] = [];
  const conflicts: FileChange[] = [];

  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      const head = line.replace('# branch.head ', '').trim();
      detachedHead = head === '(detached)';
      branch = detachedHead ? 'HEAD (detached)' : head;
      continue;
    }

    if (line.startsWith('# branch.upstream ')) {
      upstream = line.replace('# branch.upstream ', '').trim();
      continue;
    }

    if (line.startsWith('# branch.ab ')) {
      const fragment = line.replace('# branch.ab ', '').trim();
      ahead = Number(fragment.match(/\+(\d+)/)?.[1] ?? '0');
      behind = Number(fragment.match(/-(\d+)/)?.[1] ?? '0');
      continue;
    }

    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1] ?? '..';
      const x = xy[0] ?? '.';
      const y = xy[1] ?? '.';
      const path = parts.slice(8).join(' ');
      const change: FileChange = {
        path,
        section: 'unstaged',
        x,
        y,
      };

      if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
        change.section = 'conflicts';
        conflicts.push(change);
        continue;
      }

      if (x !== '.') {
        staged.push({ ...change, section: 'staged' });
      }
      if (y !== '.') {
        unstaged.push({ ...change, section: 'unstaged' });
      }
      continue;
    }

    if (line.startsWith('u ')) {
      const path = line.split(' ').slice(10).join(' ');
      conflicts.push({
        path,
        section: 'conflicts',
        x: 'U',
        y: 'U',
      });
      continue;
    }

    if (line.startsWith('? ')) {
      const path = line.replace('? ', '').trim();
      untracked.push({
        path,
        section: 'untracked',
        x: '?',
        y: '?',
      });
    }
  }

  return { branch, detachedHead, upstream, ahead, behind, staged, unstaged, untracked, conflicts };
}

export function parseBranchRefs(output: string, currentBranchName?: string): BranchInfo[] {
  const branches: BranchInfo[] = [];
  const lines = output.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const [refName, upstreamRaw, aheadBehindRaw, commitTimeRaw] = line.split('\t');
    if (!refName) {
      continue;
    }

    const isRemote = refName.startsWith('refs/remotes/');
    const kind = isRemote ? 'remote' : 'local';
    const short = refName
      .replace('refs/heads/', '')
      .replace('refs/remotes/', '')
      .trim();

    const remoteName = kind === 'remote' ? short.split('/')[0] : undefined;
    const upstream = upstreamRaw && upstreamRaw !== '-' ? upstreamRaw : undefined;
    const { ahead, behind } = parseAheadBehind(aheadBehindRaw ?? '');
    const isCurrent = kind === 'local' && short === currentBranchName;
    const merged = ahead === 0 && behind === 0 && Boolean(upstream);
    const stale = kind === 'local' && !upstream;
    const commitEpoch = Number(commitTimeRaw ?? '0');

    branches.push({
      name: refName,
      shortName: short,
      kind,
      remoteName,
      isCurrent,
      upstream,
      ahead,
      behind,
      merged,
      stale,
      lastCommitEpochSeconds: Number.isFinite(commitEpoch) && commitEpoch > 0 ? commitEpoch : undefined,
    });
  }

  return branches;
}

export function parseStashList(output: string): StashEntry[] {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const entries: StashEntry[] = [];
  const pattern = /^(stash@\{(\d+)\}):(?:\s*On\s+([^:]+):)?\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    entries.push({
      ref: match[1],
      index: Number(match[2]),
      branch: match[3]?.trim(),
      message: match[4].trim(),
    });
  }

  return entries;
}

export function formatRelativeAge(epochSeconds?: number): string {
  if (!epochSeconds) {
    return 'unknown';
  }

  const diff = Math.max(1, Math.floor(Date.now() / 1000 - epochSeconds));
  if (diff < 60) {
    return `${diff}s`;
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`;
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h`;
  }
  return `${Math.floor(diff / 86400)}d`;
}

export function parseMiniLog(output: string): MiniLogEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, author, relativeDate, subject] = line.split('\t');
      return {
        hash,
        shortHash: hash.slice(0, 8),
        author: author ?? 'unknown',
        relativeDate: relativeDate ?? 'unknown',
        subject: subject ?? '',
      };
    })
    .filter((entry) => entry.hash.length > 0);
}

export function parseWorktrees(output: string): WorktreeInfo[] {
  const lines = output.split(/\r?\n/);
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  const pushCurrent = () => {
    if (!current.path || !current.head) {
      return;
    }
    worktrees.push({
      path: current.path,
      head: current.head,
      branch: current.branch,
      detached: Boolean(current.detached),
      bare: Boolean(current.bare),
      prunable: current.prunable,
    });
    current = {};
  };

  for (const line of lines) {
    if (!line.trim()) {
      pushCurrent();
      continue;
    }
    if (line.startsWith('worktree ')) {
      current.path = line.replace('worktree ', '').trim();
    } else if (line.startsWith('HEAD ')) {
      current.head = line.replace('HEAD ', '').trim();
    } else if (line.startsWith('branch ')) {
      current.branch = line.replace('branch refs/heads/', '').trim();
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line.startsWith('prunable ')) {
      current.prunable = line.replace('prunable ', '').trim();
    }
  }
  pushCurrent();
  return worktrees;
}
