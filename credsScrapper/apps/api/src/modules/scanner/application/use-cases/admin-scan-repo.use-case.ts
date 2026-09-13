import { StateRepositoryPort } from '../ports/state-repository.port';
import { GithubRepoLookupPort } from '../ports/github-repo-lookup.port';
import { JobQueuePort } from '../ports/job-queue.port';
import { WorkdirJoinerPort } from '../ports/workdir-joiner.port';
import { enqueueRepoScan } from './enqueue-repo-scan';

// Admin counterpart of auth/application/use-cases/scan-my-repo.use-case.ts:
// same "scan exactly this owner/name, bypass the discovery queue" job
// enqueue, minus the RepoAuthorization check - the admin route is already
// gated by AdminGuard, so there's no per-user ownership to verify here.
export class AdminScanRepoUseCase {
  constructor(
    private readonly state: StateRepositoryPort,
    private readonly githubLookup: GithubRepoLookupPort,
    private readonly jobQueue: JobQueuePort,
    private readonly workdirJoiner: WorkdirJoinerPort,
  ) {}

  async execute(owner: string, name: string): Promise<{ repoId: number; jobId: string } | 'not-found'> {
    return enqueueRepoScan(this.state, this.githubLookup, this.jobQueue, this.workdirJoiner, owner, name);
  }
}
