import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBranchRefs, parseMiniLog, parseStashList, parseStatusPorcelainV2, parseWorktrees } from '../src/domain/parsers';

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}

describe('parseStatusPorcelainV2', () => {
  it('parses branch metadata and file sections', () => {
    const result = parseStatusPorcelainV2(loadFixture('status-porcelain-v2.txt'));
    expect(result.branch).toBe('feature/login');
    expect(result.upstream).toBe('origin/feature/login');
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(1);
    expect(result.staged).toHaveLength(2);
    expect(result.unstaged).toHaveLength(2);
    expect(result.untracked).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
  });
});

describe('parseBranchRefs', () => {
  it('parses local and remote branches', () => {
    const result = parseBranchRefs(loadFixture('branches.txt'), 'main');
    const main = result.find((branch) => branch.shortName === 'main' && branch.kind === 'local');
    const hotfix = result.find((branch) => branch.shortName === 'hotfix/ci');
    const remote = result.find((branch) => branch.shortName === 'origin/main');

    expect(main?.isCurrent).toBe(true);
    expect(main?.upstream).toBe('origin/main');
    expect(hotfix?.stale).toBe(true);
    expect(remote?.kind).toBe('remote');
  });
});

describe('parseStashList', () => {
  it('parses stash refs and message', () => {
    const result = parseStashList(loadFixture('stashes.txt'));
    expect(result).toHaveLength(2);
    expect(result[0]?.ref).toBe('stash@{0}');
    expect(result[0]?.message).toContain('WIP on login flow');
  });
});

describe('parseMiniLog', () => {
  it('parses commit rows', () => {
    const result = parseMiniLog(loadFixture('minilog.txt'));
    expect(result).toHaveLength(2);
    expect(result[0]?.shortHash).toBe('11111111');
    expect(result[1]?.author).toBe('Bob');
  });
});

describe('parseWorktrees', () => {
  it('parses porcelain worktree list', () => {
    const result = parseWorktrees(loadFixture('worktrees.txt'));
    expect(result).toHaveLength(2);
    expect(result[0]?.branch).toBe('main');
    expect(result[1]?.detached).toBe(true);
  });
});
