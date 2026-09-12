import { RepoAuthorizationRepositoryPort } from '../ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { IRepoAuthorization } from '../../domain/types/repo-authorization.type';

export class DecideRepoAuthorizationUseCase {
  constructor(private readonly authorizations: RepoAuthorizationRepositoryPort) {}

  async execute(
    id: number,
    status: ERepoAuthorizationStatus,
    adminNote: string | null,
    decidedByUserId: number,
  ): Promise<IRepoAuthorization | null> {
    return this.authorizations.decide(id, status, adminNote, decidedByUserId);
  }
}
