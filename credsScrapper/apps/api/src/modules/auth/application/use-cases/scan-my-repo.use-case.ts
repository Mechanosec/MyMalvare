import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { GithubRepoLookupPort } from '../../../scanner/application/ports/github-repo-lookup.port';
import { WorkdirJoinerPort } from '../../../scanner/application/ports/workdir-joiner.port';
import { ScanRepositoryUseCase } from '../../../scanner/application/use-cases/scan-repository.use-case';

// Server-controlled, not client-controlled - same reasoning as
// scanner/presentation/scan.controller.ts's identical constant (a caller
// has no legitimate reason to choose an arbitrary filesystem path here).
const SCAN_WORKDIR = process.env.SCAN_WORKDIR ?? 'workdir';

export class ScanMyRepoUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
    private readonly githubLookup: GithubRepoLookupPort,
    private readonly scanRepository: ScanRepositoryUseCase,
    private readonly workdirJoiner: WorkdirJoinerPort,
  ) {}

  /**
   * Scans exactly the given owner/name, bypassing the shared discovery
   * queue entirely - a regular user must only ever be able to trigger a
   * scan of a repo they hold an APPROVED authorization for, never
   * whatever repo happens to be next in the admin-facing candidate queue.
   *
   * Returns null if not approved, 'not-found' if GitHub has no such
   * public repo, or the resolved repoId once the scan has run.
   */
  async execute(userId: number, owner: string, name: string): Promise<{ repoId: number } | 'not-found' | null> {
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
    await this.scanRepository.execute({ repoId, owner, name }, `https://github.com/${owner}/${name}.git`, workdir);

    return { repoId };
  }
}
