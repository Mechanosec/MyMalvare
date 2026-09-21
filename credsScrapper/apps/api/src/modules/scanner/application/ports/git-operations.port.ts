export abstract class GitOperationsPort {
  async getStorageBytes(_repoPath: string): Promise<number> {
    return 0;
  }

  async prepareHead(
    source: string,
    destDir: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) throw new Error('Git operation cancelled');
    await this.cloneBare(source, destDir);
    return this.getHeadCommit(destDir);
  }

  async prepareHistory(
    source: string,
    destDir: string,
    targetSha: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error('Git operation cancelled');
    await this.syncBare(source, destDir);
    if ((await this.getHeadCommit(destDir)) !== targetSha)
      throw new Error('History target unavailable');
  }

  abstract cloneBare(source: string, destDir: string): Promise<void>;

  abstract syncBare(source: string, destDir: string): Promise<void>;

  abstract isAncestor(repoPath: string, commit: string): Promise<boolean>;

  abstract getHeadCommit(repoPath: string): Promise<string>;

  abstract listFilesAtHead(repoPath: string): Promise<string[]>;

  /** Returns null if the file is binary (not scannable as text). */
  abstract readFileAtHead(
    repoPath: string,
    filePath: string,
  ): Promise<string | null>;

  /** Reads only the selected paths; implementations can keep one Git process open. */
  async *readFilesAtHead(
    repoPath: string,
    filePaths: readonly string[],
  ): AsyncIterable<{ filePath: string; text: string | null }> {
    for (const filePath of filePaths) {
      yield { filePath, text: await this.readFileAtHead(repoPath, filePath) };
    }
  }

  abstract iterCommitDiffs(
    repoPath: string,
    sinceCommit?: string,
    signal?: AbortSignal,
  ): AsyncIterable<{ commitSha: string; diffText: string }>;
}
