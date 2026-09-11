import { Controller, Get, Query } from '@nestjs/common';
import { GetFindingsUseCase } from '../application/use-cases/get-findings.use-case';
import { ESecretType } from '../domain/constant/secret-type.constant';
import { IFindingRecord } from '../domain/types/finding-record.type';

@Controller('findings')
export class FindingsController {
  constructor(private readonly getFindings: GetFindingsUseCase) {}

  @Get()
  async list(
    @Query('secretType') secretType?: ESecretType,
    @Query('owner') owner?: string,
    @Query('name') name?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<IFindingRecord[]> {
    return this.getFindings.execute({
      secretType,
      owner,
      name,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
