import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { IRepoAuthorization } from '../../domain/types/repo-authorization.type';

export class ListMyRepoAuthorizationsUseCase {
  constructor(private readonly authorizations: RepoAuthorizationRepositoryPort) {}

  async execute(userId: number): Promise<readonly IRepoAuthorization[]> {
    return this.authorizations.listByUser(userId);
  }
}
