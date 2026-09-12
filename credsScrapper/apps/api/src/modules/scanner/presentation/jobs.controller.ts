import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { JobQueuePort } from '../application/ports/job-queue.port';
import { IJobState } from '../domain/types/job-state.type';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobQueue: JobQueuePort) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<IJobState> {
    const job = await this.jobQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`job ${id} not found`);
    }
    return job;
  }
}
