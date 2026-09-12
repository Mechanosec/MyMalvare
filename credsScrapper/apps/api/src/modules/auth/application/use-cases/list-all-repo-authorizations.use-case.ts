import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { IRepoAuthorization } from '../../domain/types/repo-authorization.type';

export class ListAllRepoAuthorizationsUseCase {
  constructor(private readonly authorizations: RepoAuthorizationRepositoryPort) {}

  async execute(status?: ERepoAuthorizationStatus): Promise<readonly IRepoAuthorization[]> {
    return this.authorizations.listAll(status);
  }
}
