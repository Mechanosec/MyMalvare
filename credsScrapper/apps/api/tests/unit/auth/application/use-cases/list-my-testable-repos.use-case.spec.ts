import { ListMyTestableReposUseCase } from '../../../../../src/modules/auth/application/use-cases/list-my-testable-repos.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';

describe('ListMyTestableReposUseCase', () => {
  it('returns only scanned repos matching an approved authorization, case-insensitively', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([
        { id: 1, userId: 1, owner: 'Acme', name: 'Widgets', note: null, status: ERepoAuthorizationStatus.APPROVED, adminNote: null, createdAt: new Date(), decidedAt: new Date(), decidedByUserId: 2 },
        { id: 2, userId: 1, owner: 'acme', name: 'pending-repo', note: null, status: ERepoAuthorizationStatus.PENDING, adminNote: null, createdAt: new Date(), decidedAt: null, decidedByUserId: null },
      ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      listFindingsRepoOptions: jest.fn().mockResolvedValue([
        { repoId: 10, owner: 'acme', name: 'widgets', count: 3 },
        { repoId: 11, owner: 'other', name: 'unrelated', count: 5 },
      ]),
    };
    const useCase = new ListMyTestableReposUseCase(authorizations, state as never);

    const result = await useCase.execute(1);

    expect(result).toEqual([{ repoId: 10, owner: 'acme', name: 'widgets', count: 3 }]);
  });
});
