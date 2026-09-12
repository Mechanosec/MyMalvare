import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { IRepoAuthorization } from '../../domain/types/repo-authorization.type';

export class SubmitRepoAuthorizationUseCase {
  constructor(private readonly authorizations: RepoAuthorizationRepositoryPort) {}

  async execute(userId: number, owner: string, name: string, note: string | null): Promise<IRepoAuthorization> {
    return this.authorizations.create(userId, owner, name, note);
  }
}
