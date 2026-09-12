import { Controller, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { JobQueuePort } from '../application/ports/job-queue.port';
import { EJobType } from '../domain/constant/job-status.constant';

// Admin-only: this crawls the public GH Archive feed at large and queues
// arbitrary third-party repos - a regular user's scope is limited to
// their own approved repo, via repo-authorizations.controller.ts's
// mine/scan-repo route instead.
@Controller('discover')
@UseGuards(AdminGuard)
export class DiscoverController {
  constructor(private readonly jobQueue: JobQueuePort) {}

  @Post()
  async start(): Promise<{ jobId: string }> {
    const jobId = await this.jobQueue.enqueue(EJobType.DISCOVER, {});
    return { jobId };
  }
}
