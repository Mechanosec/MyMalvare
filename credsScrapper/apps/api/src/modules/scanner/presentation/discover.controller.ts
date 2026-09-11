import { Controller, Post } from '@nestjs/common';
import { DiscoverReposUseCase } from '../application/use-cases/discover-repos.use-case';
import { EJobType } from '../domain/constant/job-status.constant';
import { InMemoryJobRunner } from '../infrastructure/jobs/in-memory-job-runner';

@Controller('discover')
export class DiscoverController {
  constructor(
    private readonly discoverRepos: DiscoverReposUseCase,
    private readonly jobRunner: InMemoryJobRunner,
  ) {}

  @Post()
  start(): { jobId: string } {
    const jobId = this.jobRunner.start(EJobType.DISCOVER, () => this.discoverRepos.execute());
    return { jobId };
  }
}
