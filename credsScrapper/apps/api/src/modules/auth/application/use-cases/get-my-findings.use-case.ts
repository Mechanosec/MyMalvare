import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { IFindingsFilter, IFindingsPage } from '../../../scanner/domain/types/finding-record.type';

export class GetMyFindingsUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
  ) {}

  /**
   * Same shape as scanner's GetFindingsUseCase, but always scoped to the
   * caller's own APPROVED repos - any repoIds the caller passes are
   * ignored in favor of that scope, so a non-admin can never widen the
   * query past their own authorized repos.
   */
  async execute(userId: number, filter: Omit<IFindingsFilter, 'repoIds'>): Promise<IFindingsPage> {
    const approved = (await this.authorizations.listByUser(userId)).filter(
      (a) => a.status === ERepoAuthorizationStatus.APPROVED,
    );
    if (approved.length === 0) {
      return { items: [], total: 0 };
    }
    const repoOptions = await this.state.findFindingsRepoOptionsByOwnerName(
      approved.map((a) => ({ owner: a.owner, name: a.name })),
    );
    if (repoOptions.length === 0) {
      return { items: [], total: 0 };
    }
    return this.state.listFindings({ ...filter, repoIds: repoOptions.map((r) => r.repoId) });
  }
}
