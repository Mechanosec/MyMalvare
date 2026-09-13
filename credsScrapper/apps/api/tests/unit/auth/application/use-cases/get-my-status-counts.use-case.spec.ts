import { GetMyStatusCountsUseCase } from '../../../../../src/modules/auth/application/use-cases/get-my-status-counts.use-case';
import { ListMyTestableReposUseCase } from '../../../../../src/modules/auth/application/use-cases/list-my-testable-repos.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('GetMyStatusCountsUseCase', () => {
  it("returns null when repoId is not one of the caller's own testable repos", async () => {
    const listMyTestableRepos = {
      execute: jest.fn().mockResolvedValue([{ repoId: 99, owner: 'acme', name: 'widgets', count: 1 }]),
    } as unknown as ListMyTestableReposUseCase;
    const state = { listFindingsStatusCounts: jest.fn() } as unknown as StateRepositoryPort;
    const useCase = new GetMyStatusCountsUseCase(listMyTestableRepos, state);

    const result = await useCase.execute(1, 42);

    expect(result).toBeNull();
    expect(state.listFindingsStatusCounts).not.toHaveBeenCalled();
  });

  it('returns zero-filled counts scoped to the repo when it is testable', async () => {
    const listMyTestableRepos = {
      execute: jest.fn().mockResolvedValue([{ repoId: 42, owner: 'acme', name: 'widgets', count: 1 }]),
    } as unknown as ListMyTestableReposUseCase;
    const state = {
      listFindingsStatusCounts: jest.fn().mockResolvedValue([{ status: EFindingStatus.VALID, count: 3 }]),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyStatusCountsUseCase(listMyTestableRepos, state);

    const result = await useCase.execute(1, 42);

    expect(state.listFindingsStatusCounts).toHaveBeenCalledWith(42, undefined);
    expect(result).toContainEqual({ status: EFindingStatus.VALID, count: 3 });
    expect(result).toHaveLength(Object.values(EFindingStatus).length);
  });

  it('forwards the given secret-type filter to the state port', async () => {
    const listMyTestableRepos = {
      execute: jest.fn().mockResolvedValue([{ repoId: 42, owner: 'acme', name: 'widgets', count: 1 }]),
    } as unknown as ListMyTestableReposUseCase;
    const state = {
      listFindingsStatusCounts: jest.fn().mockResolvedValue([]),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyStatusCountsUseCase(listMyTestableRepos, state);

    await useCase.execute(1, 42, [ESecretType.GITHUB_PAT]);

    expect(state.listFindingsStatusCounts).toHaveBeenCalledWith(42, [ESecretType.GITHUB_PAT]);
  });
});
