import { IScanStatus } from '../../domain/types/queue-status.type';
import { StateRepositoryPort } from '../ports/state-repository.port';
import { JobQueuePort } from '../ports/job-queue.port';

export class GetScanStatusUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly jobs: JobQueuePort,
  ) {}

  async execute(): Promise<IScanStatus> {
    const [counts, runtime] = await Promise.all([
      this.state.getQueueStatus(),
      this.jobs.getScanRuntime(),
    ]);
    return { ...counts, runtime };
  }
}
