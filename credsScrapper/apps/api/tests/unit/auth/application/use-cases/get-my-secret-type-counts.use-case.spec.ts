import { GetMySecretTypeCountsUseCase } from '../../../../../src/modules/auth/application/use-cases/get-my-secret-type-counts.use-case';
import { ListMyTestableReposUseCase } from '../../../../../src/modules/auth/application/use-cases/list-my-testable-repos.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('GetMySecretTypeCountsUseCase', () => {
  it('returns null when repoId is not one of the caller\'s own testable repos', async () => {
    const listMyTestableRepos = {
      execute: jest.fn().mockResolvedValue([{ repoId: 99, owner: 'acme', name: 'widgets', count: 1 }]),
    } as unknown as ListMyTestableReposUseCase;
    const state = { listFindingsSecretTypeCounts: jest.fn() } as unknown as StateRepositoryPort;
    const useCase = new GetMySecretTypeCountsUseCase(listMyTestableRepos, state);

    const result = await useCase.execute(1, 42);

    expect(result).toBeNull();
    expect(state.listFindingsSecretTypeCounts).not.toHaveBeenCalled();
  });

  it('returns zero-filled counts scoped to the repo when it is testable', async () => {
    const listMyTestableRepos = {
      execute: jest.fn().mockResolvedValue([{ repoId: 42, owner: 'acme', name: 'widgets', count: 1 }]),
    } as unknown as ListMyTestableReposUseCase;
    const state = {
      listFindingsSecretTypeCounts: jest.fn().mockResolvedValue([{ secretType: ESecretType.GITHUB_PAT, count: 3 }]),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMySecretTypeCountsUseCase(listMyTestableRepos, state);

    const result = await useCase.execute(1, 42);

    expect(state.listFindingsSecretTypeCounts).toHaveBeenCalledWith(42);
    expect(result).toContainEqual({ secretType: ESecretType.GITHUB_PAT, count: 3 });
    expect(result).toHaveLength(Object.values(ESecretType).length);
  });
});
