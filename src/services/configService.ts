import * as vscode from 'vscode';

export interface GitCcConfig {
  refreshIntervalSeconds: number;
  pullRebase: boolean;
  showRemoteBranches: boolean;
  branchGroupingPrefixes: string[];
  confirmForcePush: boolean;
  defaultRemote: string;
  commitTemplate: string;
  smartCheckoutDefaultStrategy: 'ask' | 'autoStash' | 'cancel';
  postCommitAction: 'none' | 'push' | 'sync';
  enableTelemetry: boolean;
}

const SECTION = 'gitcc';

export class ConfigService {
  get(): GitCcConfig {
    const config = vscode.workspace.getConfiguration(SECTION);
    return {
      refreshIntervalSeconds: this.clamp(config.get<number>('refreshIntervalSeconds', 10), 5, 60),
      pullRebase: config.get<boolean>('pullRebase', false),
      showRemoteBranches: config.get<boolean>('showRemoteBranches', true),
      branchGroupingPrefixes: config.get<string[]>('branchGroupingPrefixes', [
        'feature/',
        'bugfix/',
        'hotfix/',
        'release/',
      ]),
      confirmForcePush: config.get<boolean>('confirmForcePush', true),
      defaultRemote: config.get<string>('defaultRemote', 'origin'),
      commitTemplate: config.get<string>('commitTemplate', ''),
      smartCheckoutDefaultStrategy: config.get<'ask' | 'autoStash' | 'cancel'>(
        'smartCheckout.defaultStrategy',
        'ask',
      ),
      postCommitAction: config.get<'none' | 'push' | 'sync'>('postCommitAction', 'none'),
      enableTelemetry: config.get<boolean>('enableTelemetry', false),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
