import { IUser } from '../../domain/types/user.type';

export abstract class UserRepositoryPort {
  /** Returns null if the email is already taken (unique constraint). */
  abstract createUser(email: string, passwordHash: string): Promise<IUser | null>;
  abstract findByEmail(email: string): Promise<IUser | null>;
  abstract findById(id: number): Promise<IUser | null>;
}
