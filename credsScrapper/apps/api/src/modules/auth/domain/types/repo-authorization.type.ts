import { ERepoAuthorizationStatus } from '../constant/repo-authorization-status.constant';

export interface IRepoAuthorization {
  readonly id: number;
  readonly userId: number;
  readonly owner: string;
  readonly name: string;
  readonly note: string | null;
  readonly status: ERepoAuthorizationStatus;
  readonly adminNote: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedByUserId: number | null;
}
