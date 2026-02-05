import * as vscode from 'vscode';

export class GitCcError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
    public readonly exitCode?: number,
  ) {
    super(message);
  }
}

export class ErrorReporter {
  async show(error: unknown, operation: string): Promise<string | undefined> {
    const normalized = this.normalize(error);
    const mapped = this.suggestAction(normalized.message, normalized.stderr);
    return vscode.window.showErrorMessage(
      `${operation} failed: ${mapped.message}`,
      ...mapped.actions,
    );
  }

  private normalize(error: unknown): GitCcError {
    if (error instanceof GitCcError) {
      return error;
    }
    if (error instanceof Error) {
      return new GitCcError(error.message);
    }
    return new GitCcError(String(error));
  }

  private suggestAction(message: string, stderr?: string): { message: string; actions: string[] } {
    const source = `${message}\n${stderr ?? ''}`.toLowerCase();

    if (source.includes('not a git repository')) {
      return { message: 'Selected folder is not a Git repository.', actions: [] };
    }
    if (source.includes('no upstream configured')) {
      return { message: 'No upstream configured for this branch.', actions: ['Set Upstream'] };
    }
    if (source.includes('could not read from remote repository') || source.includes('authentication failed')) {
      return { message: 'Authentication failed. Check credentials and use VS Code Git auth.', actions: [] };
    }
    if (source.includes('pathspec')) {
      return { message: 'Branch or file was not found. Refresh and retry.', actions: [] };
    }
    if (source.includes('nothing to commit')) {
      return { message: 'Nothing to commit. Stage changes first.', actions: [] };
    }
    if (source.includes('merge conflict')) {
      return { message: 'Repository has conflicts. Resolve conflicts before continuing.', actions: [] };
    }
    if (source.includes('would be overwritten by checkout')) {
      return { message: 'Checkout would overwrite local changes.', actions: ['Smart Checkout'] };
    }
    if (source.includes('non-fast-forward')) {
      return { message: 'Push rejected (non-fast-forward).', actions: ['Pull then Push', 'Force with Lease'] };
    }

    return { message, actions: [] };
  }
}
