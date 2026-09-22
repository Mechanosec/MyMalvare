import { IJobState } from '../../domain/types/job-state.type';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import {
  IScanControlState,
  IScanRuntime,
} from '../../domain/types/scan-control.type';

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

  abstract readScanControl(): Promise<IScanControlState>;

  abstract requestStopAllScans(): Promise<IScanControlState>;

  abstract getScanRuntime(): Promise<IScanRuntime>;

  abstract hasActiveScansBefore(epoch: number): Promise<boolean>;

  /** Other active work that could still mutate this repo during an explicit retry. */
  abstract hasOtherActiveScanForRepo(
    repoId: number,
    currentJobId: string,
    currentTimestamp: number,
  ): Promise<boolean>;

  abstract completeScanStop(epoch: number): Promise<boolean>;
}
