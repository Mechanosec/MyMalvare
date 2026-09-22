import { IScanControlState } from '../../domain/types/scan-control.type';
import { JobQueuePort } from '../ports/job-queue.port';

export class StopAllScansUseCase {
  constructor(private readonly jobs: JobQueuePort) {}

  execute(): Promise<IScanControlState> {
    return this.jobs.requestStopAllScans();
  }
}
