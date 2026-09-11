import { ESecretType } from '../../domain/constant/secret-type.constant';
import { IFindingRecord, IFindingsFilter } from '../../domain/types/finding-record.type';
import { IQueueStatus } from '../../domain/types/queue-status.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';

// Abstract class rather than an interface: the class itself doubles as
// the NestJS DI token (`{ provide: StateRepositoryPort, useClass: ... }`),
// no companion Symbol/string token needed.
export abstract class StateRepositoryPort {
  /** Returns true if a new candidate row was inserted, false if repoId is already known. */
  abstract addCandidate(repoId: number, owner: string, name: string): Promise<boolean>;

  abstract isKnown(repoId: number): Promise<boolean>;

  /**
   * Atomically claims one pending unit of work (a candidate, or a
   * requeued stale scanned_repos row) and marks it in_progress.
   * Returns null if nothing is pending.
   */
  abstract claimNext(): Promise<IRepoRef | null>;

  abstract markDone(repoId: number, lastCommitSha: string): Promise<void>;

  abstract markFailed(repoId: number, reason: string): Promise<void>;

  /** Resets in_progress rows older than timeoutSeconds back to pending. Returns count changed. */
  abstract requeueStale(timeoutSeconds: number): Promise<number>;

  abstract addFinding(
    repoId: number,
    owner: string,
    name: string,
    filePath: string,
    commitSha: string,
    secretType: ESecretType,
    secretValue: string,
    lineNumber: number,
    context: string | null,
  ): Promise<void>;

  abstract countFindings(repoId: number): Promise<number>;

  abstract getQueueStatus(): Promise<IQueueStatus>;

  abstract listFindings(filter: IFindingsFilter): Promise<IFindingRecord[]>;
}
