import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../scanner/application/ports/github-repo-lookup.port';
import { JobQueuePort } from '../../../scanner/application/ports/job-queue.port';
import { WorkdirJoinerPort } from '../../../scanner/application/ports/workdir-joiner.port';

// Server-controlled, not client-controlled - same reasoning as
// scanner/presentation/scan.controller.ts's identical constant (a caller
// has no legitimate reason to choose an arbitrary filesystem path here).
const SCAN_WORKDIR = process.env.SCAN_WORKDIR ?? 'workdir';

export class ScanMyRepoUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
    private readonly githubLookup: GithubRepoLookupPort,
    private readonly jobQueue: JobQueuePort,
    private readonly workdirJoiner: WorkdirJoinerPort,
  ) {}

  /**
   * Scans exactly the given owner/name, bypassing the shared discovery
   * queue entirely. Enqueues a 'scan-repo' BullMQ job and returns
   * immediately with its jobId - the caller watches progress via
   * GET /jobs/:id or the WebSocket gateway, same as the admin scan flow.
   *
   * Returns null if not approved, 'not-found' if GitHub has no such
   * public repo, or { repoId, jobId } once the job is enqueued.
   */
  async execute(
    userId: number,
    owner: string,
    name: string,
  ): Promise<{ repoId: number; jobId: string } | 'not-found' | null> {
    const approved = await this.authorizations.listByUser(userId);
    const isApproved = approved.some(
      (a) =>
        a.status === ERepoAuthorizationStatus.APPROVED &&
        a.owner.toLowerCase() === owner.toLowerCase() &&
        a.name.toLowerCase() === name.toLowerCase(),
    );
    if (!isApproved) {
      return null;
    }

    const repoId = await this.githubLookup.resolveRepoId(owner, name);
    if (repoId === null) {
      return 'not-found';
    }

    await this.state.startRepoScan(repoId, owner, name);
    await this.workdirJoiner.ensureDir(SCAN_WORKDIR);
    const workdir = this.workdirJoiner.join(SCAN_WORKDIR, `repo-${repoId}`);
    const jobId = await this.jobQueue.enqueue('scan-repo', {
      repoRef: { repoId, owner, name },
      cloneSource: `https://github.com/${owner}/${name}.git`,
      workdir,
    });

    return { repoId, jobId };
  }
}
