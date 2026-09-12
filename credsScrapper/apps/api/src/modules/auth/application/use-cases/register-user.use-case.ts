import { UserRepositoryPort } from '../ports/user-repository.port';
import { PasswordHasherPort } from '../ports/password-hasher.port';
import { TokenPort } from '../../../identity/application/ports/token.port';
import { IAuthenticatedUser } from '../../../identity/domain/types/authenticated-user.type';

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly token: TokenPort,
  ) {}

  async execute(email: string, plainPassword: string): Promise<{ token: string; user: IAuthenticatedUser } | null> {
    if (!email?.trim() || !email.includes('@') || !plainPassword || plainPassword.length < 8) {
      throw new Error('Invalid email or password: email must contain "@" and password must be 8+ characters');
    }
    const passwordHash = await this.hasher.hash(plainPassword);
    const user = await this.users.createUser(email, passwordHash);
    if (!user) {
      return null;
    }
    const authenticated: IAuthenticatedUser = { id: user.id, email: user.email, role: user.role };
    return { token: this.token.sign(authenticated), user: authenticated };
  }
}
