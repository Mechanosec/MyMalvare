export abstract class ScanCachePort {
  /** Holds an exclusive local-filesystem lock through scan AND persistence. */
  abstract acquire(
    workdir: string,
    source: string,
  ): Promise<{
    repoPath: string;
    scannerVersion: string;
    release(): Promise<void>;
  }>;
}
