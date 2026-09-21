import { ESecretType } from '../domain/constant/secret-type.constant';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { GetScannedReposUseCase } from '../application/use-cases/get-scanned-repos.use-case';
import { GetScanStatusUseCase } from '../application/use-cases/get-scan-status.use-case';
import { AdminScanRepoUseCase } from '../application/use-cases/admin-scan-repo.use-case';
import { JobQueuePort } from '../application/ports/job-queue.port';
import { EJobType } from '../domain/constant/job-status.constant';
import { IQueueStatus } from '../domain/types/queue-status.type';
import { IScannedRepoRecord } from '../domain/types/scanned-repo-record.type';
import { StartScanDto } from './dto/start-scan.dto';
import { ScanRepoDto } from './dto/scan-repo.dto';

// Server-controlled, not client-controlled (see StartScanDto's comment) -
// the caller has no legitimate reason to choose an arbitrary filesystem
// path on this server.
const SCAN_WORKDIR = process.env.SCAN_WORKDIR ?? 'workdir';

@Controller('scan')
export class ScanController {
  constructor(
    private readonly getScanStatus: GetScanStatusUseCase,
    private readonly getScannedRepos: GetScannedReposUseCase,
    private readonly jobQueue: JobQueuePort,
    private readonly adminScanRepo: AdminScanRepoUseCase,
  ) {}

  // Admin-only: this drains the shared candidate queue (arbitrary
  // third-party repos discovered via GH Archive) - a regular user's scope
  // is their own approved repo, via repo-authorizations.controller.ts's
  // mine/scan-repo route instead.
  @Post()
  @UseGuards(AdminGuard)
  async start(@Body() dto: StartScanDto): Promise<{ jobId: string }> {
    const jobId = await this.jobQueue.enqueue(EJobType.SCAN, {
      workdirRoot: SCAN_WORKDIR,
      workers: dto.workers ?? 2,
      maxRepos: dto.maxRepos,
      staleTimeoutSeconds: dto.staleTimeoutSeconds ?? 3600,
    });
    return { jobId };
  }

  // Admin-only: aggregate counts still reveal the scale of the shared
  // discovery queue (third-party repos), which the closed-system design
  // keeps out of unauthenticated/non-admin view entirely.
  @Get('status')
  @UseGuards(AdminGuard)
  async status(): Promise<IQueueStatus> {
    return this.getScanStatus.execute();
  }

  // Admin-only: scans exactly the given owner/name, bypassing the shared
  // discovery queue entirely - lets an admin (re-)scan one specific repo
  // on demand instead of waiting for it to come up in the GH Archive feed.
  @Post('repo')
  @UseGuards(AdminGuard)
  async scanRepo(
    @Body() dto: ScanRepoDto,
  ): Promise<{ repoId: number; jobId: string }> {
    if (!dto.owner || !dto.name) {
      throw new BadRequestException('owner and name are required');
    }
    if (
      dto.secretType !== undefined &&
      !Object.values(ESecretType).includes(dto.secretType)
    ) {
      throw new BadRequestException('Unsupported rescan secret type');
    }
    const result = await this.adminScanRepo.execute(
      dto.owner,
      dto.name,
      dto.secretType,
    );
    if (result === 'not-found') {
      throw new NotFoundException(
        `GitHub repo ${dto.owner}/${dto.name} not found`,
      );
    }
    return result;
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
