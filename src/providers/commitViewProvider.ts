import * as vscode from 'vscode';
import { CommitOptions } from '../types/git';
import { StatusInfo } from '../types/git';

export interface CommitRequest {
  message: string;
  options: CommitOptions;
}

export interface CommitFileToggleRequest {
  path: string;
  stage: boolean;
}

export class CommitViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly onCommitEmitter = new vscode.EventEmitter<CommitRequest>();
  private readonly onToggleFileEmitter = new vscode.EventEmitter<CommitFileToggleRequest>();
  readonly onCommit = this.onCommitEmitter.event;
  readonly onToggleFile = this.onToggleFileEmitter.event;

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
      } else if (message?.type === 'toggleFile') {
        this.onToggleFileEmitter.fire({
          path: String(message.path ?? ''),
          stage: Boolean(message.stage),
        });
      }
    });
  }

  updateStatus(status: StatusInfo): void {
    const files = new Map<
      string,
      { path: string; staged: boolean; untracked: boolean; conflicted: boolean; hasUnstaged: boolean }
    >();
    for (const entry of status.staged) {
      files.set(entry.path, {
        path: entry.path,
        staged: true,
        untracked: false,
        conflicted: false,
        hasUnstaged: false,
      });
    }
    for (const entry of status.unstaged) {
      const existing = files.get(entry.path);
      files.set(entry.path, {
        path: entry.path,
        staged: existing?.staged ?? false,
        untracked: false,
        conflicted: false,
        hasUnstaged: true,
      });
    }
    for (const entry of status.untracked) {
      const existing = files.get(entry.path);
      files.set(entry.path, {
        path: entry.path,
        staged: existing?.staged ?? false,
        untracked: true,
        conflicted: false,
        hasUnstaged: existing?.hasUnstaged ?? true,
      });
    }
    for (const entry of status.conflicts) {
      const existing = files.get(entry.path);
      files.set(entry.path, {
        path: entry.path,
        staged: existing?.staged ?? false,
        untracked: existing?.untracked ?? false,
        conflicted: true,
        hasUnstaged: true,
      });
    }

    this.view?.webview.postMessage({
      type: 'status',
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
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
    :root {
      --panel: color-mix(in srgb, var(--vscode-editor-background) 92%, #000 8%);
      --panel-border: color-mix(in srgb, var(--vscode-editorWidget-border, #2b2f3a) 70%, #000 30%);
      --primary: var(--vscode-button-background);
      --primary-fg: var(--vscode-button-foreground);
      --secondary: color-mix(in srgb, var(--vscode-editor-background) 82%, #111 18%);
    }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      margin: 0;
      padding: 8px;
      background: transparent;
    }
    .card {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      border-radius: 6px;
      padding: 8px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .chip {
      border: 1px solid var(--panel-border);
      background: var(--secondary);
      color: var(--vscode-foreground);
      border-radius: 4px;
      font-size: 11px;
      padding: 2px 6px;
      cursor: pointer;
    }
    .chip.active {
      border-color: var(--primary);
      color: var(--primary-fg);
      background: color-mix(in srgb, var(--primary) 28%, transparent);
    }
    textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      box-sizing: border-box;
      margin-bottom: 8px;
      border-radius: 4px;
      border: 1px solid var(--primary);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px;
      outline: none;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 8px;
      opacity: 0.95;
    }
    .meta .right {
      color: var(--vscode-textLink-foreground);
    }
    .staged-list {
      margin: 0 0 8px;
      padding-left: 16px;
      max-height: 84px;
      overflow-y: auto;
      font-size: 12px;
    }
    .file-list {
      margin: 0 0 10px;
      padding: 0;
      list-style: none;
      max-height: 170px;
      overflow-y: auto;
      border: 1px solid var(--panel-border);
      border-radius: 4px;
    }
    .file-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 7px;
      border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 75%, transparent);
      font-size: 12px;
    }
    .file-row:last-child {
      border-bottom: none;
    }
    .file-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      font-size: 10px;
      border: 1px solid var(--panel-border);
      border-radius: 999px;
      padding: 1px 6px;
      opacity: 0.9;
    }
    .badge.warn {
      border-color: color-mix(in srgb, #d97706 70%, var(--panel-border));
      color: color-mix(in srgb, #f59e0b 80%, var(--vscode-foreground));
    }
    .badge.ok {
      border-color: color-mix(in srgb, #2563eb 70%, var(--panel-border));
      color: color-mix(in srgb, #60a5fa 80%, var(--vscode-foreground));
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 6px;
    }
    button {
      border: none;
      padding: 8px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
    }
    .primary {
      background: var(--primary);
      color: var(--primary-fg);
    }
    .secondary {
      background: var(--secondary);
      color: var(--vscode-foreground);
      border: 1px solid var(--panel-border);
    }
    .menu {
      position: absolute;
      right: 14px;
      bottom: 52px;
      border: 1px solid var(--panel-border);
      background: var(--panel);
      border-radius: 6px;
      padding: 6px;
      display: none;
      z-index: 2;
      min-width: 160px;
    }
    .menu button {
      width: 100%;
      margin: 0;
      text-align: left;
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 4px;
      padding: 6px;
      border: none;
      font-weight: 400;
    }
    .menu button:hover {
      background: var(--secondary);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="toolbar">
      <strong>Commit</strong>
      <span id="stagedSummary">0 modified</span>
    </div>

    <div class="toggle-row">
      <label><input type="checkbox" id="amend" /> Amend</label>
      <button id="signoffChip" class="chip" data-key="signoff">signoff</button>
      <button id="signChip" class="chip" data-key="sign">sign</button>
      <button id="noVerifyChip" class="chip" data-key="noVerify">no-verify</button>
    </div>

    <textarea id="message" placeholder="Commit message">${escapedTemplate}</textarea>

    <div class="meta">
      <span>Changes: <span id="stagedCount">0</span> staged, <span id="unstagedCount">0</span> unstaged, <span id="untrackedCount">0</span> unversioned, <span id="conflictsCount">0</span> conflicts</span>
      <span class="right" id="stagedHint">No staged files</span>
    </div>

    <ul id="stagedList" class="staged-list"></ul>
    <ul id="fileList" class="file-list"></ul>

    <div class="actions">
      <button id="commitBtn" class="primary">Commit</button>
      <button id="commitPushBtn" class="secondary">Commit and Push...</button>
      <button id="moreBtn" class="secondary">⋯</button>
    </div>
    <div class="menu" id="moreMenu">
      <button id="commitSyncBtn">Commit and Sync</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = { signoff: false, sign: false, noVerify: false };

    function postCommit(mode) {
      vscode.postMessage({
        type: 'commit',
        message: document.getElementById('message').value,
        amend: document.getElementById('amend').checked,
        signoff: state.signoff,
        sign: state.sign,
        noVerify: state.noVerify,
        pushAfter: mode === 'push',
        syncAfter: mode === 'sync',
      });
    }

    function renderChips() {
      document.getElementById('signoffChip').classList.toggle('active', state.signoff);
      document.getElementById('signChip').classList.toggle('active', state.sign);
      document.getElementById('noVerifyChip').classList.toggle('active', state.noVerify);
    }

    document.getElementById('signoffChip').addEventListener('click', () => { state.signoff = !state.signoff; renderChips(); });
    document.getElementById('signChip').addEventListener('click', () => { state.sign = !state.sign; renderChips(); });
    document.getElementById('noVerifyChip').addEventListener('click', () => { state.noVerify = !state.noVerify; renderChips(); });

    document.getElementById('commitBtn').addEventListener('click', () => postCommit('commit'));
    document.getElementById('commitPushBtn').addEventListener('click', () => postCommit('push'));
    document.getElementById('commitSyncBtn').addEventListener('click', () => {
      document.getElementById('moreMenu').style.display = 'none';
      postCommit('sync');
    });

    document.getElementById('moreBtn').addEventListener('click', () => {
      const menu = document.getElementById('moreMenu');
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    window.addEventListener('click', (event) => {
      if (!event.target.closest('#moreBtn') && !event.target.closest('#moreMenu')) {
        document.getElementById('moreMenu').style.display = 'none';
      }
    });

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
      document.getElementById('stagedSummary').textContent = String(staged.length) + ' modified';
      document.getElementById('stagedHint').textContent = staged.length ? 'Staged files ready' : 'No staged files';

      const list = document.getElementById('stagedList');
      const fileList = document.getElementById('fileList');
      list.innerHTML = '';
      fileList.innerHTML = '';
      for (const file of staged.slice(0, 30)) {
        const li = document.createElement('li');
        li.textContent = file;
        list.appendChild(li);
      }

      for (const file of (msg.files || [])) {
        const row = document.createElement('li');
        row.className = 'file-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(file.staged);
        checkbox.disabled = Boolean(file.conflicted);
        checkbox.addEventListener('change', () => {
          vscode.postMessage({
            type: 'toggleFile',
            path: file.path,
            stage: checkbox.checked,
          });
        });

        const path = document.createElement('span');
        path.className = 'file-path';
        path.textContent = file.path;
        row.appendChild(checkbox);
        row.appendChild(path);

        if (file.conflicted) {
          const badge = document.createElement('span');
          badge.className = 'badge warn';
          badge.textContent = 'conflict';
          row.appendChild(badge);
        } else if (file.untracked) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'unversioned';
          row.appendChild(badge);
        } else if (file.hasUnstaged) {
          const badge = document.createElement('span');
          badge.className = 'badge ok';
          badge.textContent = 'modified';
          row.appendChild(badge);
        }

        fileList.appendChild(row);
      }
    });

    renderChips();
  </script>
</body>
</html>`;
  }
}
