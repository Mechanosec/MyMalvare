import { GetMyTestingFacetsUseCase } from '../../../../../src/modules/auth/application/use-cases/get-my-testing-facets.use-case';
import { ListMyTestableReposUseCase } from '../../../../../src/modules/auth/application/use-cases/list-my-testable-repos.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('GetMyTestingFacetsUseCase', () => {
  const filter = { secretTypes: [], testableTypes: [ESecretType.GITHUB_PAT] };

  it('restricts facets to approved repositories and rejects an unauthorized selection', async () => {
    const approvedRepos = {
      execute: jest.fn().mockResolvedValue([{ repoId: 42 }]),
    } as unknown as ListMyTestableReposUseCase;
    const state = {
      getTestingFacets: jest
        .fn()
        .mockResolvedValue({ repositories: [], statuses: [], secretTypes: [] }),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyTestingFacetsUseCase(approvedRepos, state);

    await useCase.execute(1, filter);
    expect(state.getTestingFacets).toHaveBeenCalledWith({
      ...filter,
      scopeRepoIds: [42],
    });

    expect(await useCase.execute(1, { ...filter, repoId: 99 })).toEqual({
      repositories: [],
      statuses: [],
      secretTypes: [],
    });
    expect(state.getTestingFacets).toHaveBeenCalledTimes(1);
  });
});
