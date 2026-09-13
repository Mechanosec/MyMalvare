import { ESecretType } from '../../../scanner/domain/constant/secret-type.constant';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { IStatusCount } from '../../../scanner/domain/types/finding-record.type';
import { fillZeroStatusCounts } from '../../../scanner/application/use-cases/get-findings-status-counts.use-case';
import { ListMyTestableReposUseCase } from './list-my-testable-repos.use-case';

export class GetMyStatusCountsUseCase {
  constructor(
    private readonly listMyTestableRepos: ListMyTestableReposUseCase,
    private readonly state: StateRepositoryPort,
  ) {}

  /** Returns null if repoId isn't one of the caller's own approved+testable repos. */
  async execute(
    userId: number,
    repoId: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IStatusCount[] | null> {
    const testable = await this.listMyTestableRepos.execute(userId);
    if (!testable.some((r) => r.repoId === repoId)) {
      return null;
    }
    return fillZeroStatusCounts(await this.state.listFindingsStatusCounts(repoId, secretTypes));
  }
}
