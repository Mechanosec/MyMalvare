import { ListMyTestableReposUseCase } from '../../../../../src/modules/auth/application/use-cases/list-my-testable-repos.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('ListMyTestableReposUseCase', () => {
  it('returns only scanned repos matching an approved authorization, case-insensitively', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([
        { id: 1, userId: 1, owner: 'Acme', name: 'Widgets', note: null, status: ERepoAuthorizationStatus.APPROVED, adminNote: null, createdAt: new Date(), decidedAt: new Date(), decidedByUserId: 2 },
        { id: 2, userId: 1, owner: 'acme', name: 'pending-repo', note: null, status: ERepoAuthorizationStatus.PENDING, adminNote: null, createdAt: new Date(), decidedAt: null, decidedByUserId: null },
      ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest.fn().mockResolvedValue([
        { repoId: 10, owner: 'acme', name: 'widgets', count: 3 },
      ]),
    };
    const useCase = new ListMyTestableReposUseCase(authorizations, state as never);

    const result = await useCase.execute(1);

    expect(state.findFindingsRepoOptionsByOwnerName).toHaveBeenCalledWith(
      [{ owner: 'Acme', name: 'Widgets' }],
      undefined,
    );
    expect(result).toEqual([{ repoId: 10, owner: 'acme', name: 'widgets', count: 3 }]);
  });

  it('forwards a secretTypes filter to scope which repos even appear', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([
        { id: 1, userId: 1, owner: 'acme', name: 'widgets', note: null, status: ERepoAuthorizationStatus.APPROVED, adminNote: null, createdAt: new Date(), decidedAt: new Date(), decidedByUserId: 2 },
      ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest.fn().mockResolvedValue([]),
    };
    const useCase = new ListMyTestableReposUseCase(authorizations, state as never);

    await useCase.execute(1, [ESecretType.GITHUB_PAT]);

    expect(state.findFindingsRepoOptionsByOwnerName).toHaveBeenCalledWith(
      [{ owner: 'acme', name: 'widgets' }],
      [ESecretType.GITHUB_PAT],
    );
  });
});
