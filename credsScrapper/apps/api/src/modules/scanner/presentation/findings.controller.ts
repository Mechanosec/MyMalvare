import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { SetFindingStatusUseCase } from '../application/use-cases/set-finding-status.use-case';
import { AdminTestRepoFindingsUseCase } from '../application/use-cases/admin-test-repo-findings.use-case';
import { AdminTestFindingUseCase } from '../application/use-cases/admin-test-finding.use-case';
import { GetFindingsRepoOptionsUseCase } from '../application/use-cases/get-findings-repo-options.use-case';
import { GetFindingsSecretTypeCountsUseCase } from '../application/use-cases/get-findings-secret-type-counts.use-case';
import { GetFindingsStatusCountsUseCase } from '../application/use-cases/get-findings-status-counts.use-case';
import { GetFindingsUseCase } from '../application/use-cases/get-findings.use-case';
import { GetTestingFacetsUseCase } from '../application/use-cases/get-testing-facets.use-case';
import { EFindingStatus } from '../domain/constant/finding-status.constant';
import { ESecretType } from '../domain/constant/secret-type.constant';
import {
  IFindingRecord,
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
  IStatusCount,
  ITestingFacets,
} from '../domain/types/finding-record.type';

function parseCsv<T>(
  value: string | undefined,
  map: (raw: string) => T = (raw) => raw as T,
): T[] | undefined {
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
    private readonly getTestingFacets: GetTestingFacetsUseCase,
    private readonly getFindingsRepoOptions: GetFindingsRepoOptionsUseCase,
    private readonly getFindingsSecretTypeCounts: GetFindingsSecretTypeCountsUseCase,
    private readonly getFindingsStatusCounts: GetFindingsStatusCountsUseCase,
    private readonly setFindingStatus: SetFindingStatusUseCase,
    private readonly adminTestRepoFindings: AdminTestRepoFindingsUseCase,
    private readonly adminTestFinding: AdminTestFindingUseCase,
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
  async repoOptions(
    @Query('limit') limit?: string,
    @Query('secretTypes') secretTypes?: string,
  ): Promise<IFindingsRepoOption[]> {
    return this.getFindingsRepoOptions.execute(
      limit ? Number(limit) : undefined,
      parseCsv<ESecretType>(secretTypes),
    );
  }

  @Get('testing-facets')
  async testingFacets(
    @Query('repoId') repoId?: string,
    @Query('status') status?: EFindingStatus,
    @Query('secretTypes') secretTypes?: string,
    @Query('testableTypes') testableTypes?: string,
  ): Promise<ITestingFacets> {
    if (
      repoId &&
      (!Number.isSafeInteger(Number(repoId)) || Number(repoId) <= 0)
    ) {
      throw new BadRequestException('repoId must be a positive integer');
    }
    if (status && !Object.values(EFindingStatus).includes(status)) {
      throw new BadRequestException('Invalid finding status');
    }
    const allowedTypes = parseCsv<ESecretType>(testableTypes);
    if (
      !allowedTypes?.length ||
      allowedTypes.some((type) => !Object.values(ESecretType).includes(type))
    ) {
      throw new BadRequestException('Invalid testable secret types');
    }
    const selectedTypes = parseCsv<ESecretType>(secretTypes) ?? [];
    if (selectedTypes.some((type) => !allowedTypes.includes(type))) {
      throw new BadRequestException('Secret types must be testable');
    }
    return this.getTestingFacets.execute({
      repoId: repoId ? Number(repoId) : undefined,
      status,
      secretTypes: selectedTypes,
      testableTypes: allowedTypes,
    });
  }

  @Get('secret-type-counts')
  async secretTypeCounts(
    @Query('repoId') repoId?: string,
  ): Promise<ISecretTypeCount[]> {
    return this.getFindingsSecretTypeCounts.execute(
      repoId ? Number(repoId) : undefined,
    );
  }

  @Get('status-counts')
  async statusCounts(
    @Query('repoId') repoId?: string,
    @Query('secretTypes') secretTypes?: string,
  ): Promise<IStatusCount[]> {
    return this.getFindingsStatusCounts.execute(
      repoId ? Number(repoId) : undefined,
      parseCsv<ESecretType>(secretTypes),
    );
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

  @Post('test-repo/:repoId')
  async testRepo(
    @Param('repoId') repoId: string,
  ): Promise<readonly IFindingRecord[]> {
    return this.adminTestRepoFindings.execute(Number(repoId));
  }

  @Post(':id/test')
  async testOne(@Param('id') id: string): Promise<IFindingRecord> {
    const result = await this.adminTestFinding.execute(Number(id));
    if (!result) {
      throw new NotFoundException(`Finding ${id} not found`);
    }
    return result;
  }
}
