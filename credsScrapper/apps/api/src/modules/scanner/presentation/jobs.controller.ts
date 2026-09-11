import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { IJobState, InMemoryJobRunner } from '../infrastructure/jobs/in-memory-job-runner';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobRunner: InMemoryJobRunner) {}

  @Get(':id')
  get(@Param('id') id: string): IJobState {
    const job = this.jobRunner.get(id);
    if (!job) {
      throw new NotFoundException(`job ${id} not found`);
    }
    return job;
  }
}
