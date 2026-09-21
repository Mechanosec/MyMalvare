import { ListMyTestableReposUseCase } from './list-my-testable-repos.use-case';
import { StateRepositoryPort } from '../../../scanner/application/ports/state-repository.port';
import {
  ITestingFacets,
  ITestingFacetsFilter,
} from '../../../scanner/domain/types/finding-record.type';

export class GetMyTestingFacetsUseCase {
  constructor(
    private readonly listMyTestableRepos: ListMyTestableReposUseCase,
    private readonly state: StateRepositoryPort,
  ) {}

  async execute(
    userId: number,
    filter: Omit<ITestingFacetsFilter, 'scopeRepoIds'>,
  ): Promise<ITestingFacets> {
    const approvedIds = (await this.listMyTestableRepos.execute(userId)).map(
      (repo) => repo.repoId,
    );
    if (
      approvedIds.length === 0 ||
      (filter.repoId !== undefined && !approvedIds.includes(filter.repoId))
    ) {
      return { repositories: [], statuses: [], secretTypes: [] };
    }
    return this.state.getTestingFacets({
      ...filter,
      scopeRepoIds: approvedIds,
    });
  }
}
