import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../scanner/domain/constant/finding-status.constant';
import { findOwnedFinding } from './find-owned-finding';

export class SetMyFindingStatusUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
  ) {}

  /** Returns false if the finding doesn't exist or isn't in one of the caller's own approved repos. */
  async execute(userId: number, findingId: number, status: EFindingStatus): Promise<boolean> {
    const finding = await findOwnedFinding(this.authorizations, this.state, userId, findingId);
    if (!finding) {
      return false;
    }
    await this.state.updateFindingStatus(findingId, status);
    return true;
  }
}
