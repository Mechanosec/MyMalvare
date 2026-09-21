import { EScanPhase } from '../../domain/constant/scan-phase.constant';

export abstract class ScanCachePort {
  /** Holds an exclusive local-filesystem lock through scan AND persistence. */
  abstract acquire(
    workdir: string,
    source: string,
    phase?: EScanPhase,
  ): Promise<{
    repoPath: string;
    scannerVersion: string;
    release(): Promise<void>;
  }>;
}
