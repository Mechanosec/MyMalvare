import { EUserRole } from '../../../identity/domain/constant/user-role.constant';

export interface IUser {
  readonly id: number;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: EUserRole;
  readonly createdAt: Date;
}
