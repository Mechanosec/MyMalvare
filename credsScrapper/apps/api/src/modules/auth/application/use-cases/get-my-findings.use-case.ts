import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import {
  IFindingsFilter,
  IFindingsPage,
} from '../../../scanner/domain/types/finding-record.type';

export class GetMyFindingsUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
  ) {}

  /**
   * Same shape as scanner's GetFindingsUseCase, but always scoped to the
   * caller's own APPROVED repos. A requested repo is intersected with that
   * scope, so a non-admin can never widen the query.
   */
  async execute(
    userId: number,
    filter: IFindingsFilter,
  ): Promise<IFindingsPage> {
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
    const approvedIds = repoOptions.map((r) => r.repoId);
    const repoIds = filter.repoIds?.length
      ? approvedIds.filter((id) => filter.repoIds?.includes(id))
      : approvedIds;
    if (repoIds.length === 0) return { items: [], total: 0 };
    return this.state.listFindings({ ...filter, repoIds });
  }
}
