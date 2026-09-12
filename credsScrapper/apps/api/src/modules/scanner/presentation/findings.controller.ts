import { Controller, Get, Query } from '@nestjs/common';
import { GetFindingsRepoOptionsUseCase } from '../application/use-cases/get-findings-repo-options.use-case';
import { GetFindingsSecretTypeCountsUseCase } from '../application/use-cases/get-findings-secret-type-counts.use-case';
import { GetFindingsUseCase } from '../application/use-cases/get-findings.use-case';
import { ESecretType } from '../domain/constant/secret-type.constant';
import {
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
} from '../domain/types/finding-record.type';

function parseCsv<T>(value: string | undefined, map: (raw: string) => T = (raw) => raw as T): T[] | undefined {
  return value ? value.split(',').filter(Boolean).map(map) : undefined;
}

@Controller('findings')
export class FindingsController {
  constructor(
    private readonly getFindings: GetFindingsUseCase,
    private readonly getFindingsRepoOptions: GetFindingsRepoOptionsUseCase,
    private readonly getFindingsSecretTypeCounts: GetFindingsSecretTypeCountsUseCase,
  ) {}

  @Get()
  async list(
    @Query('secretTypes') secretTypes?: string,
    @Query('repoIds') repoIds?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<IFindingsPage> {
    return this.getFindings.execute({
      secretTypes: parseCsv<ESecretType>(secretTypes),
      repoIds: parseCsv(repoIds, Number),
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
}
