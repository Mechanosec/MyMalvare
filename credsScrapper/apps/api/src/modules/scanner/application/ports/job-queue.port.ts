import { IJobState } from '../../domain/types/job-state.type';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { IRepoRef } from '../../domain/types/repo-ref.type';

export abstract class JobQueuePort {
  /** Enqueues a job and returns its id immediately - the caller never waits for it to run. */
  abstract enqueue(type: string, payload: unknown): Promise<string>;

  async enqueuePhase(
    phase: EScanPhase,
    repoRef: IRepoRef,
    targetSha: string,
    payload: unknown,
  ): Promise<string> {
    return this.enqueue(phase, { repoRef, targetSha, payload });
  }

  abstract getJob(jobId: string): Promise<IJobState | null>;

  /**
   * Cooperative stop request - the running job checks for this at its own
   * natural checkpoints (between repos for a scan, every couple thousand
   * events for discovery) and exits early once seen. Not an immediate
   * kill: a job already mid-clone/mid-scan of one repo finishes that repo
   * first, same as it already does on a graceful process shutdown.
   */
  abstract requestStop(jobId: string): Promise<void>;

  abstract isStopRequested(jobId: string): Promise<boolean>;
}
