import { SubmitRepoAuthorizationUseCase } from '../../../../../src/modules/auth/application/use-cases/submit-repo-authorization.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';

describe('SubmitRepoAuthorizationUseCase', () => {
  it('delegates to the port', async () => {
    const authorizations = { create: jest.fn() } as unknown as RepoAuthorizationRepositoryPort;
    const useCase = new SubmitRepoAuthorizationUseCase(authorizations);

    await useCase.execute(1, 'owner', 'name', 'note');

    expect(authorizations.create).toHaveBeenCalledWith(1, 'owner', 'name', 'note');
  });
});
