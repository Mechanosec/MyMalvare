import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../scanner/domain/constant/finding-status.constant';

export class SetMyFindingStatusUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
  ) {}

  /** Returns false if the finding doesn't exist or isn't in one of the caller's own approved repos. */
  async execute(userId: number, findingId: number, status: EFindingStatus): Promise<boolean> {
    const approved = (await this.authorizations.listByUser(userId)).filter(
      (a) => a.status === ERepoAuthorizationStatus.APPROVED,
    );
    if (approved.length === 0) {
      return false;
    }
    const repoOptions = await this.state.findFindingsRepoOptionsByOwnerName(
      approved.map((a) => ({ owner: a.owner, name: a.name })),
    );
    if (repoOptions.length === 0) {
      return false;
    }
    const { items } = await this.state.listFindings({
      repoIds: repoOptions.map((r) => r.repoId),
      limit: 10000,
    });
    const owns = items.some((f) => f.id === findingId);
    if (!owns) {
      return false;
    }
    await this.state.updateFindingStatus(findingId, status);
    return true;
  }
}
