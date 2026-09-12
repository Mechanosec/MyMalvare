import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { IFindingsRepoOption } from '../../../scanner/domain/types/finding-record.type';

export class ListMyTestableReposUseCase {
  constructor(
    private readonly authorizations: RepoAuthorizationRepositoryPort,
    private readonly state: StateRepositoryPort,
  ) {}

  async execute(userId: number): Promise<IFindingsRepoOption[]> {
    const approved = (await this.authorizations.listByUser(userId)).filter(
      (a) => a.status === ERepoAuthorizationStatus.APPROVED,
    );
    if (approved.length === 0) {
      return [];
    }
    return this.state.findFindingsRepoOptionsByOwnerName(
      approved.map((a) => ({ owner: a.owner, name: a.name })),
    );
  }
}
