import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { SetFindingStatusUseCase } from '../application/use-cases/set-finding-status.use-case';
import { GetFindingsRepoOptionsUseCase } from '../application/use-cases/get-findings-repo-options.use-case';
import { GetFindingsSecretTypeCountsUseCase } from '../application/use-cases/get-findings-secret-type-counts.use-case';
import { GetFindingsUseCase } from '../application/use-cases/get-findings.use-case';
import { EFindingStatus } from '../domain/constant/finding-status.constant';
import { ESecretType } from '../domain/constant/secret-type.constant';
import {
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
} from '../domain/types/finding-record.type';

function parseCsv<T>(value: string | undefined, map: (raw: string) => T = (raw) => raw as T): T[] | undefined {
  return value ? value.split(',').filter(Boolean).map(map) : undefined;
}

// Admin-only: this is unscoped, whole-database access - a regular user's
// scope is their own approved repos, via
// repo-authorizations.controller.ts's mine/findings, mine/scanned-repos,
// and mine/findings/:id/status routes instead.
@Controller('findings')
@UseGuards(AdminGuard)
export class FindingsController {
  constructor(
    private readonly getFindings: GetFindingsUseCase,
    private readonly getFindingsRepoOptions: GetFindingsRepoOptionsUseCase,
    private readonly getFindingsSecretTypeCounts: GetFindingsSecretTypeCountsUseCase,
    private readonly setFindingStatus: SetFindingStatusUseCase,
  ) {}

  @Get()
  async list(
    @Query('secretTypes') secretTypes?: string,
    @Query('repoIds') repoIds?: string,
    @Query('statuses') statuses?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<IFindingsPage> {
    return this.getFindings.execute({
      secretTypes: parseCsv<ESecretType>(secretTypes),
      repoIds: parseCsv(repoIds, Number),
      statuses: parseCsv<EFindingStatus>(statuses),
      search: search || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('repos')
  async repoOptions(@Query('limit') limit?: string): Promise<IFindingsRepoOption[]> {
    return this.getFindingsRepoOptions.execute(limit ? Number(limit) : undefined);
  }

  @Get('secret-type-counts')
  async secretTypeCounts(): Promise<ISecretTypeCount[]> {
    return this.getFindingsSecretTypeCounts.execute();
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ): Promise<{ ok: true }> {
    if (!Object.values(EFindingStatus).includes(status as EFindingStatus)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    await this.setFindingStatus.execute(Number(id), status as EFindingStatus);
    return { ok: true };
  }
}
