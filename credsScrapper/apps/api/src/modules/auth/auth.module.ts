import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { StateRepositoryPort } from '../scanner/application/ports/state-repository.port';
import { KeyValidatorPort } from '../scanner/application/ports/key-validator.port';
import { GithubRepoLookupPort } from '../scanner/application/ports/github-repo-lookup.port';
import { WorkdirJoinerPort } from '../scanner/application/ports/workdir-joiner.port';
import { JobQueuePort } from '../scanner/application/ports/job-queue.port';
import { IdentityModule } from '../identity/identity.module';
import { TokenPort } from '../identity/application/ports/token.port';
import { provideUseCase } from '../../shared/di/provide-use-case';
import { UserRepositoryPort } from './application/ports/user-repository.port';
import { RepoAuthorizationRepositoryPort } from './application/ports/repo-authorization-repository.port';
import { PasswordHasherPort } from './application/ports/password-hasher.port';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user-repository';
import { PrismaRepoAuthorizationRepository } from './infrastructure/persistence/prisma-repo-authorization-repository';
import { BcryptPasswordHasherAdapter } from './infrastructure/security/bcrypt-password-hasher.adapter';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { SubmitRepoAuthorizationUseCase } from './application/use-cases/submit-repo-authorization.use-case';
import { ListMyRepoAuthorizationsUseCase } from './application/use-cases/list-my-repo-authorizations.use-case';
import { ListAllRepoAuthorizationsUseCase } from './application/use-cases/list-all-repo-authorizations.use-case';
import { DecideRepoAuthorizationUseCase } from './application/use-cases/decide-repo-authorization.use-case';
import { ListMyTestableReposUseCase } from './application/use-cases/list-my-testable-repos.use-case';
import { TestRepoFindingsUseCase } from './application/use-cases/test-repo-findings.use-case';
import { TestFindingUseCase } from './application/use-cases/test-finding.use-case';
import { ScanMyRepoUseCase } from './application/use-cases/scan-my-repo.use-case';
import { GetMyFindingsUseCase } from './application/use-cases/get-my-findings.use-case';
import { GetMyScannedReposUseCase } from './application/use-cases/get-my-scanned-repos.use-case';
import { SetMyFindingStatusUseCase } from './application/use-cases/set-my-finding-status.use-case';
import { GetMySecretTypeCountsUseCase } from './application/use-cases/get-my-secret-type-counts.use-case';
import { AuthController } from './presentation/auth.controller';
import { RepoAuthorizationsController } from './presentation/repo-authorizations.controller';

// PrismaService itself is NOT re-declared here: importing ScannerModule
// (which exports StateRepositoryPort) is enough to reuse its bound
// PrismaStateRepository instance without a second, redundant binding.
// Same reasoning for TokenPort/AuthGuard/AdminGuard via IdentityModule -
// this module has no `auth` <-> `scanner` circular import because
// IdentityModule depends on neither.
@Module({
  imports: [ScannerModule, IdentityModule],
  controllers: [AuthController, RepoAuthorizationsController],
  providers: [
    { provide: UserRepositoryPort, useClass: PrismaUserRepository },
    {
      provide: RepoAuthorizationRepositoryPort,
      useClass: PrismaRepoAuthorizationRepository,
    },
    { provide: PasswordHasherPort, useClass: BcryptPasswordHasherAdapter },
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
      (authorizations, state) =>
        new ListMyTestableReposUseCase(authorizations, state),
    ),
    provideUseCase(
      GetMySecretTypeCountsUseCase,
      [ListMyTestableReposUseCase, StateRepositoryPort],
      (listMyTestableRepos, state) =>
        new GetMySecretTypeCountsUseCase(listMyTestableRepos, state),
    ),
    provideUseCase(
      TestRepoFindingsUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort, KeyValidatorPort],
      (authorizations, state, validator) =>
        new TestRepoFindingsUseCase(authorizations, state, validator),
    ),
    provideUseCase(
      TestFindingUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort, KeyValidatorPort],
      (authorizations, state, validator) =>
        new TestFindingUseCase(authorizations, state, validator),
    ),
    provideUseCase(
      ScanMyRepoUseCase,
      [
        RepoAuthorizationRepositoryPort,
        StateRepositoryPort,
        GithubRepoLookupPort,
        JobQueuePort,
        WorkdirJoinerPort,
      ],
      (authorizations, state, githubLookup, jobQueue, workdirJoiner) =>
        new ScanMyRepoUseCase(
          authorizations,
          state,
          githubLookup,
          jobQueue,
          workdirJoiner,
        ),
    ),
    provideUseCase(
      GetMyFindingsUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort],
      (authorizations, state) =>
        new GetMyFindingsUseCase(authorizations, state),
    ),
    provideUseCase(
      GetMyScannedReposUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort],
      (authorizations, state) =>
        new GetMyScannedReposUseCase(authorizations, state),
    ),
    provideUseCase(
      SetMyFindingStatusUseCase,
      [RepoAuthorizationRepositoryPort, StateRepositoryPort],
      (authorizations, state) =>
        new SetMyFindingStatusUseCase(authorizations, state),
    ),
  ],
})
export class AuthModule {}
