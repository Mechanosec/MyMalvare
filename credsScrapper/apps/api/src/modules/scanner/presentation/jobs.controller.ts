import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { StopJobUseCase } from '../application/use-cases/stop-job.use-case';
import { JobQueuePort } from '../application/ports/job-queue.port';
import { IJobState } from '../domain/types/job-state.type';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobQueue: JobQueuePort,
    private readonly stopJob: StopJobUseCase,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<IJobState> {
    const job = await this.jobQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`job ${id} not found`);
    }
    return job;
  }

  // Admin-only: the discover/scan jobs this stops are already admin-only
  // to start (see scan.controller.ts/discover.controller.ts) - a
  // user-scoped stop for their own scan-repo job would need its own
  // ownership-checked route, not this one.
  @Post(':id/stop')
  @UseGuards(AdminGuard)
  async stop(@Param('id') id: string): Promise<{ ok: true }> {
    await this.stopJob.execute(id);
    return { ok: true };
  }
}
