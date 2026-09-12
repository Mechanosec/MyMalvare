import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { GetScannedReposUseCase } from '../application/use-cases/get-scanned-repos.use-case';
import { GetScanStatusUseCase } from '../application/use-cases/get-scan-status.use-case';
import { RunScanLoopUseCase } from '../application/use-cases/run-scan-loop.use-case';
import { EJobType } from '../domain/constant/job-status.constant';
import { IQueueStatus } from '../domain/types/queue-status.type';
import { IRepoRef } from '../domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../domain/types/scanned-repo-record.type';
import { InMemoryJobRunner } from '../infrastructure/jobs/in-memory-job-runner';
import { StartScanDto } from './dto/start-scan.dto';

function buildCloneUrl(ref: IRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`;
}

// Server-controlled, not client-controlled (see StartScanDto's comment) -
// the caller has no legitimate reason to choose an arbitrary filesystem
// path on this server.
const SCAN_WORKDIR = process.env.SCAN_WORKDIR ?? 'workdir';

@Controller('scan')
export class ScanController {
  constructor(
    private readonly runScanLoop: RunScanLoopUseCase,
    private readonly getScanStatus: GetScanStatusUseCase,
    private readonly getScannedRepos: GetScannedReposUseCase,
    private readonly jobRunner: InMemoryJobRunner,
  ) {}

  // Admin-only: this drains the shared candidate queue (arbitrary
  // third-party repos discovered via GH Archive) - a regular user's scope
  // is their own approved repo, via repo-authorizations.controller.ts's
  // mine/scan-repo route instead.
  @Post()
  @UseGuards(AdminGuard)
  start(@Body() dto: StartScanDto): { jobId: string } {
    const jobId = this.jobRunner.start(EJobType.SCAN, (onProgress) =>
      this.runScanLoop.execute({
        workdirRoot: SCAN_WORKDIR,
        sourceUrlFn: buildCloneUrl,
        workers: dto.workers ?? 1,
        maxRepos: dto.maxRepos,
        staleTimeoutSeconds: dto.staleTimeoutSeconds ?? 3600,
        onProgress,
      }),
    );
    return { jobId };
  }

  @Get('status')
  async status(): Promise<IQueueStatus> {
    return this.getScanStatus.execute();
  }

  // Admin-only: lists every scanned repo (owner/name/finding count) across
  // the whole database - a regular user's scope is their own approved
  // repos, via repo-authorizations.controller.ts's mine/scanned-repos.
  @Get('repos')
  @UseGuards(AdminGuard)
  async repos(@Query('limit') limit?: string): Promise<IScannedRepoRecord[]> {
    return this.getScannedRepos.execute(limit ? Number(limit) : undefined);
  }
}
