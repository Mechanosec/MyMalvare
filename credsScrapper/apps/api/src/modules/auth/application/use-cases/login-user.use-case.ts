import { UserRepositoryPort } from '../ports/user-repository.port';
import { PasswordHasherPort } from '../ports/password-hasher.port';
import { TokenPort } from '../ports/token.port';
import { IAuthenticatedUser } from '../../domain/types/user.type';

export class LoginUserUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly token: TokenPort,
  ) {}

  async execute(email: string, plainPassword: string): Promise<{ token: string; user: IAuthenticatedUser } | null> {
    const user = await this.users.findByEmail(email);
    if (!user || !(await this.hasher.compare(plainPassword, user.passwordHash))) {
      return null;
    }
    const authenticated: IAuthenticatedUser = { id: user.id, email: user.email, role: user.role };
    return { token: this.token.sign(authenticated), user: authenticated };
  }
}
