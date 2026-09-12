import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { IFindingsRepoOption } from '../../../scanner/domain/types/finding-record.type';

const REPO_OPTIONS_LIMIT = 500;

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
    const approvedKeys = new Set(approved.map((a) => `${a.owner.toLowerCase()}/${a.name.toLowerCase()}`));
    const allRepoOptions = await this.state.listFindingsRepoOptions(REPO_OPTIONS_LIMIT);
    return allRepoOptions.filter((r) => approvedKeys.has(`${r.owner.toLowerCase()}/${r.name.toLowerCase()}`));
  }
}
