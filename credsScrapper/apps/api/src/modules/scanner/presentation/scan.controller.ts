import { Body, Controller, Get, Post } from '@nestjs/common';
import { GetScanStatusUseCase } from '../application/use-cases/get-scan-status.use-case';
import { RunScanLoopUseCase } from '../application/use-cases/run-scan-loop.use-case';
import { EJobType } from '../domain/constant/job-status.constant';
import { IQueueStatus } from '../domain/types/queue-status.type';
import { IRepoRef } from '../domain/types/repo-ref.type';
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
    private readonly jobRunner: InMemoryJobRunner,
  ) {}

  @Post()
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
}
