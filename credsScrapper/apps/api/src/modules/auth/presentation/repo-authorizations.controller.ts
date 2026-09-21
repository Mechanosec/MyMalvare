import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SubmitRepoAuthorizationUseCase } from '../application/use-cases/submit-repo-authorization.use-case';
import { ListMyRepoAuthorizationsUseCase } from '../application/use-cases/list-my-repo-authorizations.use-case';
import { ListAllRepoAuthorizationsUseCase } from '../application/use-cases/list-all-repo-authorizations.use-case';
import { DecideRepoAuthorizationUseCase } from '../application/use-cases/decide-repo-authorization.use-case';
import { ListMyTestableReposUseCase } from '../application/use-cases/list-my-testable-repos.use-case';
import { TestRepoFindingsUseCase } from '../application/use-cases/test-repo-findings.use-case';
import { TestFindingUseCase } from '../application/use-cases/test-finding.use-case';
import { ScanMyRepoUseCase } from '../application/use-cases/scan-my-repo.use-case';
import { GetMyFindingsUseCase } from '../application/use-cases/get-my-findings.use-case';
import { GetMyScannedReposUseCase } from '../application/use-cases/get-my-scanned-repos.use-case';
import { SetMyFindingStatusUseCase } from '../application/use-cases/set-my-finding-status.use-case';
import { GetMySecretTypeCountsUseCase } from '../application/use-cases/get-my-secret-type-counts.use-case';
import { GetMyStatusCountsUseCase } from '../application/use-cases/get-my-status-counts.use-case';
import { AuthGuard } from '../../identity/infrastructure/guards/auth.guard';
import { AdminGuard } from '../../identity/infrastructure/guards/admin.guard';
import { ERepoAuthorizationStatus } from '../domain/constant/repo-authorization-status.constant';
import { IAuthenticatedUser } from '../../identity/domain/types/authenticated-user.type';
import { ESecretType } from '../../scanner/domain/constant/secret-type.constant';
import { EFindingStatus } from '../../scanner/domain/constant/finding-status.constant';

type TAuthedRequest = Request & { user: IAuthenticatedUser };

function parseCsv<T>(
  value: string | undefined,
  map: (raw: string) => T = (raw) => raw as T,
): T[] | undefined {
  return value ? value.split(',').filter(Boolean).map(map) : undefined;
}

@Controller('repo-authorizations')
export class RepoAuthorizationsController {
  constructor(
    private readonly submitRepoAuthorization: SubmitRepoAuthorizationUseCase,
    private readonly listMyRepoAuthorizations: ListMyRepoAuthorizationsUseCase,
    private readonly listAllRepoAuthorizations: ListAllRepoAuthorizationsUseCase,
    private readonly decideRepoAuthorization: DecideRepoAuthorizationUseCase,
    private readonly listMyTestableRepos: ListMyTestableReposUseCase,
    private readonly testRepoFindings: TestRepoFindingsUseCase,
    private readonly testFinding: TestFindingUseCase,
    private readonly scanMyRepo: ScanMyRepoUseCase,
    private readonly getMyFindings: GetMyFindingsUseCase,
    private readonly getMyScannedRepos: GetMyScannedReposUseCase,
    private readonly setMyFindingStatus: SetMyFindingStatusUseCase,
    private readonly getMySecretTypeCounts: GetMySecretTypeCountsUseCase,
    private readonly getMyStatusCounts: GetMyStatusCountsUseCase,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  async submit(
    @Req() req: TAuthedRequest,
    @Body('owner') owner: string,
    @Body('name') name: string,
    @Body('note') note?: string,
  ) {
    return this.submitRepoAuthorization.execute(
      req.user.id,
      owner,
      name,
      note ?? null,
    );
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  async mine(@Req() req: TAuthedRequest) {
    return this.listMyRepoAuthorizations.execute(req.user.id);
  }

  @Get('mine/findings')
  @UseGuards(AuthGuard)
  async myFindings(
    @Req() req: TAuthedRequest,
    @Query('secretTypes') secretTypes?: string,
    @Query('statuses') statuses?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.getMyFindings.execute(req.user.id, {
      secretTypes: parseCsv<ESecretType>(secretTypes),
      statuses: parseCsv<EFindingStatus>(statuses),
      search: search || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('mine/scanned-repos')
  @UseGuards(AuthGuard)
  async myScannedRepos(@Req() req: TAuthedRequest) {
    return this.getMyScannedRepos.execute(req.user.id);
  }

  @Get('mine/testable-repos')
  @UseGuards(AuthGuard)
  async testableRepos(
    @Req() req: TAuthedRequest,
    @Query('secretTypes') secretTypes?: string,
  ) {
    return this.listMyTestableRepos.execute(
      req.user.id,
      parseCsv<ESecretType>(secretTypes),
    );
  }

  @Get('mine/secret-type-counts')
  @UseGuards(AuthGuard)
  async mySecretTypeCounts(
    @Req() req: TAuthedRequest,
    @Query('repoId') repoId: string,
  ) {
    const result = await this.getMySecretTypeCounts.execute(
      req.user.id,
      Number(repoId),
    );
    if (result === null) {
      throw new ForbiddenException(
        'You do not have an approved authorization for this repository',
      );
    }
    return result;
  }

  @Get('mine/status-counts')
  @UseGuards(AuthGuard)
  async myStatusCounts(
    @Req() req: TAuthedRequest,
    @Query('repoId') repoId: string,
    @Query('secretTypes') secretTypes?: string,
  ) {
    const result = await this.getMyStatusCounts.execute(
      req.user.id,
      Number(repoId),
      parseCsv<ESecretType>(secretTypes),
    );
    if (result === null) {
      throw new ForbiddenException(
        'You do not have an approved authorization for this repository',
      );
    }
    return result;
  }

  @Post('mine/scan-repo')
  @UseGuards(AuthGuard)
  async scanRepo(
    @Req() req: TAuthedRequest,
    @Body('owner') owner: string,
    @Body('name') name: string,
    @Body('secretType') secretType?: ESecretType,
  ) {
    if (
      secretType !== undefined &&
      !Object.values(ESecretType).includes(secretType)
    ) {
      throw new BadRequestException('Unsupported rescan secret type');
    }
    const result = await this.scanMyRepo.execute(
      req.user.id,
      owner,
      name,
      secretType,
    );
    if (result === null) {
      throw new ForbiddenException(
        'You do not have an approved authorization for this repository',
      );
    }
    if (result === 'not-found') {
      throw new NotFoundException(`GitHub repo ${owner}/${name} not found`);
    }
    return result;
  }

  @Patch('mine/findings/:id/status')
  @UseGuards(AuthGuard)
  async myFindingStatus(
    @Req() req: TAuthedRequest,
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    if (!Object.values(EFindingStatus).includes(status as EFindingStatus)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    const ok = await this.setMyFindingStatus.execute(
      req.user.id,
      Number(id),
      status as EFindingStatus,
    );
    if (!ok) {
      throw new ForbiddenException(
        'This finding is not in one of your approved repositories',
      );
    }
    return { ok: true };
  }

  @Post('mine/test-repo/:repoId')
  @UseGuards(AuthGuard)
  async testRepo(@Req() req: TAuthedRequest, @Param('repoId') repoId: string) {
    const result = await this.testRepoFindings.execute(
      req.user.id,
      Number(repoId),
    );
    if (result === null) {
      throw new ForbiddenException(
        'You do not have an approved authorization for this repository',
      );
    }
    return result;
  }

  @Post('mine/test-finding/:id')
  @UseGuards(AuthGuard)
  async testOneFinding(@Req() req: TAuthedRequest, @Param('id') id: string) {
    const result = await this.testFinding.execute(req.user.id, Number(id));
    if (result === null) {
      throw new ForbiddenException(
        'This finding is not in one of your approved repositories',
      );
    }
    return result;
  }

  @Get()
  @UseGuards(AdminGuard)
  async all(@Query('status') status?: string) {
    if (
      status &&
      !Object.values(ERepoAuthorizationStatus).includes(
        status as ERepoAuthorizationStatus,
      )
    ) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    return this.listAllRepoAuthorizations.execute(
      status as ERepoAuthorizationStatus | undefined,
    );
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async decide(
    @Req() req: TAuthedRequest,
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('adminNote') adminNote?: string,
  ) {
    if (
      !Object.values(ERepoAuthorizationStatus).includes(
        status as ERepoAuthorizationStatus,
      )
    ) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    const result = await this.decideRepoAuthorization.execute(
      Number(id),
      status as ERepoAuthorizationStatus,
      adminNote ?? null,
      req.user.id,
    );
    if (!result) {
      throw new NotFoundException(`Repo authorization ${id} not found`);
    }
    return result;
  }
}
