import { EUserRole } from '../constant/user-role.constant';

// The JWT-decoded shape attached to a request - never carries passwordHash.
export interface IAuthenticatedUser {
  readonly id: number;
  readonly email: string;
  readonly role: EUserRole;
}
