import { DecideRepoAuthorizationUseCase } from '../../../../../src/modules/auth/application/use-cases/decide-repo-authorization.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';

describe('DecideRepoAuthorizationUseCase', () => {
  it('delegates to the port', async () => {
    const authorizations = { decide: jest.fn() } as unknown as RepoAuthorizationRepositoryPort;
    const useCase = new DecideRepoAuthorizationUseCase(authorizations);

    await useCase.execute(7, ERepoAuthorizationStatus.APPROVED, 'looks good', 2);

    expect(authorizations.decide).toHaveBeenCalledWith(7, ERepoAuthorizationStatus.APPROVED, 'looks good', 2);
  });
});
