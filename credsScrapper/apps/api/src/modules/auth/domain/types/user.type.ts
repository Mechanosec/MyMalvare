import { EUserRole } from '../constant/user-role.constant';

export interface IUser {
  readonly id: number;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: EUserRole;
  readonly createdAt: Date;
}

// The JWT-decoded shape attached to a request - never carries passwordHash.
export interface IAuthenticatedUser {
  readonly id: number;
  readonly email: string;
  readonly role: EUserRole;
}
