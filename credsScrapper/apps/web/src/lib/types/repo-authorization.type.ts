export type TRepoAuthorizationStatus = 'pending' | 'approved' | 'rejected';

export interface IRepoAuthorization {
  readonly id: number;
  readonly userId: number;
  readonly owner: string;
  readonly name: string;
  readonly note: string | null;
  readonly status: TRepoAuthorizationStatus;
  readonly adminNote: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedByUserId: number | null;
}
