import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { IScannedRepoRecord } from '../../../scanner/domain/types/scanned-repo-record.type';

const SCANNED_REPOS_LIMIT = 1000;

export class GetMyScannedReposUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
  ) {}

  /**
   * StateRepositoryPort.listScannedRepos has no owner/name filter, so this
   * fetches a large page and filters in memory - fine at this table's
   * current scale, and never returns the raw list to the caller either
   * way (only the entries matching their own approved repos).
   */
  async execute(userId: number): Promise<IScannedRepoRecord[]> {
    const approved = (await this.authorizations.listByUser(userId)).filter(
      (a) => a.status === ERepoAuthorizationStatus.APPROVED,
    );
    if (approved.length === 0) {
      return [];
    }
    const approvedKeys = new Set(approved.map((a) => `${a.owner.toLowerCase()}/${a.name.toLowerCase()}`));
    const all = await this.state.listScannedRepos(SCANNED_REPOS_LIMIT);
    return all.filter((r) => approvedKeys.has(`${r.owner.toLowerCase()}/${r.name.toLowerCase()}`));
  }
}
