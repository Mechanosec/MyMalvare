export type TUserRole = 'user' | 'admin';

export interface IAuthUser {
  readonly id: number;
  readonly email: string;
  readonly role: TUserRole;
}

export interface IAuthResult {
  readonly token: string;
  readonly user: IAuthUser;
}
