export abstract class GitOperationsPort {
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
  ): AsyncIterable<{ commitSha: string; diffText: string }>;
}
