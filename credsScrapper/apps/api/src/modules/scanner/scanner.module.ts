import { Module } from '@nestjs/common';
import { ScanCachePort } from './application/ports/scan-cache.port';
import { FsScanCacheAdapter } from './infrastructure/fs/fs-scan-cache.adapter';
import { provideUseCase } from '../../shared/di/provide-use-case';
import { IdentityModule } from '../identity/identity.module';
import { AdminGuard } from '../identity/infrastructure/guards/admin.guard';
import { AdminTestRepoFindingsUseCase } from './application/use-cases/admin-test-repo-findings.use-case';
import { AdminTestFindingUseCase } from './application/use-cases/admin-test-finding.use-case';
import { AdminScanRepoUseCase } from './application/use-cases/admin-scan-repo.use-case';
import { DiscoveryFeedPort } from './application/ports/discovery-feed.port';
import { GithubRepoLookupPort } from './application/ports/github-repo-lookup.port';
import { KeyValidatorPort } from './application/ports/key-validator.port';
import { LoggerPort } from './application/ports/logger.port';
import { ProgressPort } from './application/ports/progress.port';
import { StateRepositoryPort } from './application/ports/state-repository.port';
import { WorkdirCleanerPort } from './application/ports/workdir-cleaner.port';
import { WorkdirJoinerPort } from './application/ports/workdir-joiner.port';
import { ScanWorkerPort } from './application/ports/scan-worker.port';
import { PiscinaScanWorkerAdapter } from './infrastructure/workers/piscina-scan-worker.adapter';
import { HeadScanWorkerPort } from './application/ports/head-scan-worker.port';
import { HistoryScanWorkerPort } from './application/ports/history-scan-worker.port';
import { EScanPhase } from './domain/constant/scan-phase.constant';
import {
  HEAD_SCAN_WORKER_POOL_SIZE,
  HISTORY_SCAN_WORKER_POOL_SIZE,
} from './infrastructure/workers/pool-size';
import { DiscoverReposUseCase } from './application/use-cases/discover-repos.use-case';
import { GetFindingsRepoOptionsUseCase } from './application/use-cases/get-findings-repo-options.use-case';
import { GetFindingsSecretTypeCountsUseCase } from './application/use-cases/get-findings-secret-type-counts.use-case';
import { GetFindingsStatusCountsUseCase } from './application/use-cases/get-findings-status-counts.use-case';
import { StopJobUseCase } from './application/use-cases/stop-job.use-case';
import { GetFindingsUseCase } from './application/use-cases/get-findings.use-case';
import { GetScannedReposUseCase } from './application/use-cases/get-scanned-repos.use-case';
import { GetScanStatusUseCase } from './application/use-cases/get-scan-status.use-case';
import { RunScanLoopUseCase } from './application/use-cases/run-scan-loop.use-case';
import { ScanRepositoryUseCase } from './application/use-cases/scan-repository.use-case';
import { ScanRepositoryPhaseUseCase } from './application/use-cases/scan-repository-phase.use-case';
import { ReconcileScanPhasesUseCase } from './application/use-cases/reconcile-scan-phases.use-case';
import { SetFindingStatusUseCase } from './application/use-cases/set-finding-status.use-case';
import { GhArchiveHttpAdapter } from './infrastructure/discovery/gharchive-http-adapter';
import { GithubApiRepoLookupAdapter } from './infrastructure/discovery/github-api-repo-lookup.adapter';
import { FsWorkdirCleanerAdapter } from './infrastructure/fs/fs-workdir-cleaner.adapter';
import { FsWorkdirJoinerAdapter } from './infrastructure/fs/fs-workdir-joiner.adapter';
import { JobQueuePort } from './application/ports/job-queue.port';
import { BullmqJobQueueAdapter } from './infrastructure/jobs/bullmq-job-queue.adapter';
import { BullmqJobWorker } from './infrastructure/jobs/bullmq-job-worker';
import { RescanRepositoryServiceUseCase } from './application/use-cases/rescan-repository-service.use-case';
import { NestLoggerAdapter } from './infrastructure/logging/nest-logger.adapter';
import { LiveKeyValidatorAdapter } from './infrastructure/validation/live-key-validator.adapter';
import { PrismaService } from './infrastructure/persistence/prisma.service';
import { PrismaStateRepository } from './infrastructure/persistence/prisma-state-repository';
import { ProgressGateway } from './infrastructure/websocket/progress.gateway';
import { DiscoverController } from './presentation/discover.controller';
import { FindingsController } from './presentation/findings.controller';
import { JobsController } from './presentation/jobs.controller';
import { ScanController } from './presentation/scan.controller';

// This is the one file in the module allowed to know every concrete
// adapter - it binds each application/ports abstract class to its
// infrastructure implementation, and wires the framework-free use-cases
// into Nest's DI container via provideUseCase.
@Module({
  imports: [IdentityModule],
  controllers: [
    DiscoverController,
    ScanController,
    FindingsController,
    JobsController,
  ],
  providers: [
    PrismaService,
    { provide: ScanCachePort, useClass: FsScanCacheAdapter },
    { provide: StateRepositoryPort, useClass: PrismaStateRepository },
    {
      provide: ScanWorkerPort,
      useFactory: () => new PiscinaScanWorkerAdapter(),
    },
    {
      provide: HeadScanWorkerPort,
      useFactory: () =>
        new PiscinaScanWorkerAdapter({
          maxThreads: HEAD_SCAN_WORKER_POOL_SIZE,
        }),
    },
    {
      provide: HistoryScanWorkerPort,
      useFactory: () =>
        new PiscinaScanWorkerAdapter({
          maxThreads: HISTORY_SCAN_WORKER_POOL_SIZE,
        }),
    },
    { provide: DiscoveryFeedPort, useClass: GhArchiveHttpAdapter },
    { provide: LoggerPort, useClass: NestLoggerAdapter },
    { provide: ProgressPort, useClass: ProgressGateway },
    { provide: WorkdirCleanerPort, useClass: FsWorkdirCleanerAdapter },
    { provide: WorkdirJoinerPort, useClass: FsWorkdirJoinerAdapter },
    { provide: JobQueuePort, useClass: BullmqJobQueueAdapter },
    BullmqJobWorker,
    provideUseCase(
      RescanRepositoryServiceUseCase,
      [
        HeadScanWorkerPort,
        HistoryScanWorkerPort,
        ScanCachePort,
        StateRepositoryPort,
      ],
      (head, history, cache, state) =>
        new RescanRepositoryServiceUseCase(head, history, cache, state),
    ),
    provideUseCase(
      DiscoverReposUseCase,
      [DiscoveryFeedPort, StateRepositoryPort, LoggerPort],
      (feed, state, logger) => new DiscoverReposUseCase(feed, state, logger),
    ),
    provideUseCase(
      ScanRepositoryUseCase,
      [
        ScanWorkerPort,
        StateRepositoryPort,
        LoggerPort,
        WorkdirCleanerPort,
        ScanCachePort,
      ],
      (scanWorker, state, logger, cleaner, cache) =>
        new ScanRepositoryUseCase(scanWorker, state, logger, cleaner, cache),
    ),
    provideUseCase(
      ScanRepositoryPhaseUseCase,
      [
        HeadScanWorkerPort,
        HistoryScanWorkerPort,
        StateRepositoryPort,
        LoggerPort,
        WorkdirCleanerPort,
        ScanCachePort,
      ],
      (headWorker, historyWorker, state, logger, cleaner, cache) =>
        new ScanRepositoryPhaseUseCase(
          headWorker,
          historyWorker,
          state,
          logger,
          cleaner,
          cache,
        ),
    ),
    provideUseCase(
      ReconcileScanPhasesUseCase,
      [StateRepositoryPort, JobQueuePort, WorkdirJoinerPort],
      (state, jobs, joiner) =>
        new ReconcileScanPhasesUseCase(state, jobs, joiner),
    ),
    provideUseCase(
      RunScanLoopUseCase,
      [
        StateRepositoryPort,
        ScanRepositoryUseCase,
        LoggerPort,
        WorkdirJoinerPort,
        ScanRepositoryPhaseUseCase,
        JobQueuePort,
      ],
      (state, scanRepository, logger, joiner, phaseScanner, jobs) =>
        new RunScanLoopUseCase(
          state,
          scanRepository,
          logger,
          joiner,
          phaseScanner,
          jobs,
        ),
    ),
    provideUseCase(
      GetFindingsUseCase,
      [StateRepositoryPort],
      (state) => new GetFindingsUseCase(state),
    ),
    provideUseCase(
      GetFindingsRepoOptionsUseCase,
      [StateRepositoryPort],
      (state) => new GetFindingsRepoOptionsUseCase(state),
    ),
    provideUseCase(
      GetFindingsSecretTypeCountsUseCase,
      [StateRepositoryPort],
      (state) => new GetFindingsSecretTypeCountsUseCase(state),
    ),
    provideUseCase(
      GetFindingsStatusCountsUseCase,
      [StateRepositoryPort],
      (state) => new GetFindingsStatusCountsUseCase(state),
    ),
    provideUseCase(
      StopJobUseCase,
      [JobQueuePort],
      (jobQueue) => new StopJobUseCase(jobQueue),
    ),
    provideUseCase(
      GetScanStatusUseCase,
      [StateRepositoryPort],
      (state) => new GetScanStatusUseCase(state),
    ),
    provideUseCase(
      GetScannedReposUseCase,
      [StateRepositoryPort],
      (state) => new GetScannedReposUseCase(state),
    ),
    provideUseCase(
      SetFindingStatusUseCase,
      [StateRepositoryPort],
      (state) => new SetFindingStatusUseCase(state),
    ),
    provideUseCase(
      AdminTestRepoFindingsUseCase,
      [StateRepositoryPort, KeyValidatorPort],
      (state, validator) => new AdminTestRepoFindingsUseCase(state, validator),
    ),
    provideUseCase(
      AdminTestFindingUseCase,
      [StateRepositoryPort, KeyValidatorPort],
      (state, validator) => new AdminTestFindingUseCase(state, validator),
    ),
    provideUseCase(
      AdminScanRepoUseCase,
      [
        StateRepositoryPort,
        GithubRepoLookupPort,
        JobQueuePort,
        WorkdirJoinerPort,
      ],
      (state, githubLookup, jobQueue, workdirJoiner) =>
        new AdminScanRepoUseCase(state, githubLookup, jobQueue, workdirJoiner),
    ),
    { provide: KeyValidatorPort, useClass: LiveKeyValidatorAdapter },
    { provide: GithubRepoLookupPort, useClass: GithubApiRepoLookupAdapter },
  ],
  exports: [
    StateRepositoryPort,
    PrismaService,
    KeyValidatorPort,
    GithubRepoLookupPort,
    WorkdirJoinerPort,
    JobQueuePort,
  ],
})
export class ScannerModule {}
