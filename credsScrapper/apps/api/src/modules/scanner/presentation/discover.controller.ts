import { Controller, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { DiscoverReposUseCase } from '../application/use-cases/discover-repos.use-case';
import { EJobType } from '../domain/constant/job-status.constant';
import { InMemoryJobRunner } from '../infrastructure/jobs/in-memory-job-runner';

// Admin-only: this crawls the public GH Archive feed at large and queues
// arbitrary third-party repos - a regular user's scope is limited to
// their own approved repo, via repo-authorizations.controller.ts's
// mine/scan-repo route instead.
@Controller('discover')
@UseGuards(AdminGuard)
export class DiscoverController {
  constructor(
    private readonly discoverRepos: DiscoverReposUseCase,
    private readonly jobRunner: InMemoryJobRunner,
  ) {}

  @Post()
  start(): { jobId: string } {
    const jobId = this.jobRunner.start(EJobType.DISCOVER, (onProgress) =>
      this.discoverRepos.execute(undefined, onProgress),
    );
    return { jobId };
  }
}
