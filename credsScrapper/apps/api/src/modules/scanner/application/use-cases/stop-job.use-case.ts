import { JobQueuePort } from '../ports/job-queue.port';

export class StopJobUseCase {
  constructor(private readonly jobQueue: JobQueuePort) {}

  async execute(jobId: string): Promise<void> {
    await this.jobQueue.requestStop(jobId);
  }
}
