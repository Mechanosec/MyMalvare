import { GetTestingFacetsUseCase } from '../../../../../src/modules/scanner/application/use-cases/get-testing-facets.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('GetTestingFacetsUseCase', () => {
  it('passes the three independent filter selections to the state port', async () => {
    const facets = { repositories: [], statuses: [], secretTypes: [] };
    const state = {
      getTestingFacets: jest.fn().mockResolvedValue(facets),
    } as unknown as StateRepositoryPort;
    const useCase = new GetTestingFacetsUseCase(state);
    const filter = {
      repoId: 42,
      status: EFindingStatus.UNKNOWN,
      secretTypes: [ESecretType.GITHUB_PAT],
      testableTypes: [ESecretType.GITHUB_PAT, ESecretType.SLACK_TOKEN],
    };

    expect(await useCase.execute(filter)).toBe(facets);
    expect(state.getTestingFacets).toHaveBeenCalledWith(filter);
  });
});
