import * as vscode from 'vscode';

export class DisposableStore implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  add<T extends vscode.Disposable>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      try {
        disposable?.dispose();
      } catch {
        // ignore dispose errors
      }
    }
  }
}
