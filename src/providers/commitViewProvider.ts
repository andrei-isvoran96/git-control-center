import * as vscode from 'vscode';
import { CommitOptions } from '../types/git';
import { StatusInfo } from '../types/git';

export interface CommitRequest {
  message: string;
  options: CommitOptions;
}

export class CommitViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly onCommitEmitter = new vscode.EventEmitter<CommitRequest>();
  readonly onCommit = this.onCommitEmitter.event;

  constructor(private readonly commitTemplate: string) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview, this.commitTemplate);
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'commit') {
        this.onCommitEmitter.fire({
          message: String(message.message ?? '').trim(),
          options: {
            amend: Boolean(message.amend),
            signoff: Boolean(message.signoff),
            sign: Boolean(message.sign),
            noVerify: Boolean(message.noVerify),
            pushAfter: Boolean(message.pushAfter),
            syncAfter: Boolean(message.syncAfter),
          },
        });
      }
    });
  }

  updateStatus(status: StatusInfo): void {
    this.view?.webview.postMessage({
      type: 'status',
      staged: status.staged.map((item) => item.path),
      unstaged: status.unstaged.map((item) => item.path),
      untracked: status.untracked.map((item) => item.path),
      conflicts: status.conflicts.map((item) => item.path),
    });
  }

  focus(): void {
    this.view?.show?.(true);
  }

  private getHtml(webview: vscode.Webview, template: string): string {
    const nonce = Date.now().toString(36);
    const escapedTemplate = template.replace(/</g, '&lt;');
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
    textarea { width: 100%; min-height: 72px; box-sizing: border-box; margin-bottom: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .actions { display: grid; grid-template-columns: 1fr; gap: 6px; margin-top: 6px; }
    button { width: 100%; border: none; padding: 8px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    label { font-size: 12px; }
    .meta { font-size: 12px; margin: 4px 0 8px; opacity: 0.9; }
    .group { margin-bottom: 8px; }
    .group strong { font-size: 12px; display: inline-block; margin-bottom: 4px; }
    ul { margin: 0; padding-left: 16px; max-height: 72px; overflow-y: auto; font-size: 12px; }
  </style>
</head>
<body>
  <textarea id="message" placeholder="Commit message">${escapedTemplate}</textarea>
  <div class="meta">
    Changes: staged <span id="stagedCount">0</span>,
    unstaged <span id="unstagedCount">0</span>,
    untracked <span id="untrackedCount">0</span>,
    conflicts <span id="conflictsCount">0</span>
  </div>
  <div class="group">
    <strong>Staged</strong>
    <ul id="stagedList"></ul>
  </div>
  <div class="group">
    <strong>Other Changes</strong>
    <ul id="otherList"></ul>
  </div>
  <div class="row">
    <label><input type="checkbox" id="amend" /> amend</label>
    <label><input type="checkbox" id="signoff" /> signoff</label>
    <label><input type="checkbox" id="sign" /> sign</label>
    <label><input type="checkbox" id="noVerify" /> no-verify</label>
  </div>
  <div class="actions">
    <button id="commitBtn">Commit</button>
    <button id="commitPushBtn">Commit & Push</button>
    <button id="commitSyncBtn">Commit & Sync</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function postCommit(mode) {
      vscode.postMessage({
        type: 'commit',
        message: document.getElementById('message').value,
        amend: document.getElementById('amend').checked,
        signoff: document.getElementById('signoff').checked,
        sign: document.getElementById('sign').checked,
        noVerify: document.getElementById('noVerify').checked,
        pushAfter: mode === 'push',
        syncAfter: mode === 'sync',
      });
    }

    document.getElementById('commitBtn').addEventListener('click', () => postCommit('commit'));
    document.getElementById('commitPushBtn').addEventListener('click', () => postCommit('push'));
    document.getElementById('commitSyncBtn').addEventListener('click', () => postCommit('sync'));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type !== 'status') return;
      const staged = msg.staged || [];
      const unstaged = msg.unstaged || [];
      const untracked = msg.untracked || [];
      const conflicts = msg.conflicts || [];

      document.getElementById('stagedCount').textContent = String(staged.length);
      document.getElementById('unstagedCount').textContent = String(unstaged.length);
      document.getElementById('untrackedCount').textContent = String(untracked.length);
      document.getElementById('conflictsCount').textContent = String(conflicts.length);

      const stagedList = document.getElementById('stagedList');
      const otherList = document.getElementById('otherList');
      stagedList.innerHTML = '';
      otherList.innerHTML = '';

      for (const file of staged) {
        const li = document.createElement('li');
        li.textContent = file;
        stagedList.appendChild(li);
      }

      for (const file of [...unstaged, ...untracked.map(f => f + ' (untracked)'), ...conflicts.map(f => f + ' (conflict)')].slice(0, 50)) {
        const li = document.createElement('li');
        li.textContent = file;
        otherList.appendChild(li);
      }
    });
  </script>
</body>
</html>`;
  }
}
