import { ListMyRepoAuthorizationsUseCase } from '../../../../../src/modules/auth/application/use-cases/list-my-repo-authorizations.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';

describe('ListMyRepoAuthorizationsUseCase', () => {
  it('delegates to the port', async () => {
    const authorizations = { listByUser: jest.fn() } as unknown as RepoAuthorizationRepositoryPort;
    const useCase = new ListMyRepoAuthorizationsUseCase(authorizations);

    await useCase.execute(1);

    expect(authorizations.listByUser).toHaveBeenCalledWith(1);
  });
});
