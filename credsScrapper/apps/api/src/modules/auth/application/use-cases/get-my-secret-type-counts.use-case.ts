import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import { ISecretTypeCount } from '../../../scanner/domain/types/finding-record.type';
import { fillZeroSecretTypeCounts } from '../../../scanner/application/use-cases/get-findings-secret-type-counts.use-case';
import { ListMyTestableReposUseCase } from './list-my-testable-repos.use-case';

export class GetMySecretTypeCountsUseCase {
  constructor(
    private readonly listMyTestableRepos: ListMyTestableReposUseCase,
    private readonly state: StateRepositoryPort,
  ) {}

  /** Returns null if repoId isn't one of the caller's own approved+testable repos. */
  async execute(userId: number, repoId: number): Promise<ISecretTypeCount[] | null> {
    const testable = await this.listMyTestableRepos.execute(userId);
    if (!testable.some((r) => r.repoId === repoId)) {
      return null;
    }
    return fillZeroSecretTypeCounts(await this.state.listFindingsSecretTypeCounts(repoId));
  }
}
