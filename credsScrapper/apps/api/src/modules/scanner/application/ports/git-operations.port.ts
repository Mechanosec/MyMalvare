export abstract class GitOperationsPort {
  abstract cloneBare(source: string, destDir: string): Promise<void>;

  abstract getHeadCommit(repoPath: string): Promise<string>;

  abstract listFilesAtHead(repoPath: string): Promise<string[]>;

  /** Returns null if the file is binary (not scannable as text). */
  abstract readFileAtHead(repoPath: string, filePath: string): Promise<string | null>;

  abstract iterCommitDiffs(
    repoPath: string,
  ): Promise<Array<{ commitSha: string; diffText: string }>>;
}
