import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { StateRepositoryPort } from '../scanner/application/ports/state-repository.port';
import { provideUseCase } from '../../shared/di/provide-use-case';
import { UserRepositoryPort } from './application/ports/user-repository.port';
import { RepoAuthorizationRepositoryPort } from './application/ports/repo-authorization-repository.port';
import { PasswordHasherPort } from './application/ports/password-hasher.port';
import { TokenPort } from './application/ports/token.port';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user-repository';
import { PrismaRepoAuthorizationRepository } from './infrastructure/persistence/prisma-repo-authorization-repository';
import { BcryptPasswordHasherAdapter } from './infrastructure/security/bcrypt-password-hasher.adapter';
import { JwtTokenAdapter } from './infrastructure/security/jwt-token.adapter';
import { AuthGuard } from './infrastructure/guards/auth.guard';
import { AdminGuard } from './infrastructure/guards/admin.guard';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { SubmitRepoAuthorizationUseCase } from './application/use-cases/submit-repo-authorization.use-case';
import { ListMyRepoAuthorizationsUseCase } from './application/use-cases/list-my-repo-authorizations.use-case';
import { ListAllRepoAuthorizationsUseCase } from './application/use-cases/list-all-repo-authorizations.use-case';
import { DecideRepoAuthorizationUseCase } from './application/use-cases/decide-repo-authorization.use-case';
import { ListMyTestableReposUseCase } from './application/use-cases/list-my-testable-repos.use-case';
import { AuthController } from './presentation/auth.controller';
import { RepoAuthorizationsController } from './presentation/repo-authorizations.controller';

// PrismaService itself is NOT re-declared here: importing ScannerModule
// (which exports StateRepositoryPort) is enough to reuse its bound
// PrismaStateRepository instance without a second, redundant binding.
@Module({
  imports: [ScannerModule],
  controllers: [AuthController, RepoAuthorizationsController],
  providers: [
    { provide: UserRepositoryPort, useClass: PrismaUserRepository },
    { provide: RepoAuthorizationRepositoryPort, useClass: PrismaRepoAuthorizationRepository },
    { provide: PasswordHasherPort, useClass: BcryptPasswordHasherAdapter },
    { provide: TokenPort, useClass: JwtTokenAdapter },
    { provide: AuthGuard, useFactory: (token: TokenPort) => new AuthGuard(token), inject: [TokenPort] },
    { provide: AdminGuard, useFactory: (token: TokenPort) => new AdminGuard(token), inject: [TokenPort] },
    provideUseCase(
      RegisterUserUseCase,
      [UserRepositoryPort, PasswordHasherPort, TokenPort],
      (users, hasher, token) => new RegisterUserUseCase(users, hasher, token),
    ),
    provideUseCase(
      LoginUserUseCase,
      [UserRepositoryPort, PasswordHasherPort, TokenPort],
      (users, hasher, token) => new LoginUserUseCase(users, hasher, token),
    ),
    provideUseCase(
      SubmitRepoAuthorizationUseCase,
      [RepoAuthorizationRepositoryPort],
      (authorizations) => new SubmitRepoAuthorizationUseCase(authorizations),
    ),
    provideUseCase(
      ListMyRepoAuthorizationsUseCase,
      [RepoAuthorizationRepositoryPort],
      (authorizations) => new ListMyRepoAuthorizationsUseCase(authorizations),
    ),
    provideUseCase(
      ListAllRepoAuthorizationsUseCase,
      [RepoAuthorizationRepositoryPort],
      (authorizations) => new ListAllRepoAuthorizationsUseCase(authorizations),
    ),
    provideUseCase(
      DecideRepoAuthorizationUseCase,
      [RepoAuthorizationRepositoryPort],
      (authorizations) => new DecideRepoAuthorizationUseCase(authorizations),
    ),
    provideUseCase(
      ListMyTestableReposUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort],
      (authorizations, state) => new ListMyTestableReposUseCase(authorizations, state),
    ),
  ],
})
export class AuthModule {}
