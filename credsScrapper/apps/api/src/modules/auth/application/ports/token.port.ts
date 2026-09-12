import { IAuthenticatedUser } from '../../domain/types/user.type';

export abstract class TokenPort {
  abstract sign(payload: IAuthenticatedUser): string;
  /** Returns null for a missing, malformed, or expired token - never throws. */
  abstract verify(token: string): IAuthenticatedUser | null;
}
