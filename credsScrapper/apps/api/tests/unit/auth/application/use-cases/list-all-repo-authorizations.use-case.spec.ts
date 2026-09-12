import { ListAllRepoAuthorizationsUseCase } from '../../../../../src/modules/auth/application/use-cases/list-all-repo-authorizations.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';

describe('ListAllRepoAuthorizationsUseCase', () => {
  it('delegates to the port', async () => {
    const authorizations = { listAll: jest.fn() } as unknown as RepoAuthorizationRepositoryPort;
    const useCase = new ListAllRepoAuthorizationsUseCase(authorizations);

    await useCase.execute(ERepoAuthorizationStatus.PENDING);

    expect(authorizations.listAll).toHaveBeenCalledWith(ERepoAuthorizationStatus.PENDING);
  });
});
