import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { IRepoAuthorization } from '../../domain/types/repo-authorization.type';

export abstract class RepoAuthorizationRepositoryPort {
  abstract create(
    userId: number,
    owner: string,
    name: string,
    note: string | null,
  ): Promise<IRepoAuthorization>;
  abstract listByUser(userId: number): Promise<readonly IRepoAuthorization[]>;
  abstract listAll(status?: ERepoAuthorizationStatus): Promise<readonly IRepoAuthorization[]>;
  abstract findById(id: number): Promise<IRepoAuthorization | null>;
  abstract decide(
    id: number,
    status: ERepoAuthorizationStatus,
    adminNote: string | null,
    decidedByUserId: number,
  ): Promise<IRepoAuthorization | null>;
}
