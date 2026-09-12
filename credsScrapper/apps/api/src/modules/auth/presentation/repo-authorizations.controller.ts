import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SubmitRepoAuthorizationUseCase } from '../application/use-cases/submit-repo-authorization.use-case';
import { ListMyRepoAuthorizationsUseCase } from '../application/use-cases/list-my-repo-authorizations.use-case';
import { ListAllRepoAuthorizationsUseCase } from '../application/use-cases/list-all-repo-authorizations.use-case';
import { DecideRepoAuthorizationUseCase } from '../application/use-cases/decide-repo-authorization.use-case';
import { ListMyTestableReposUseCase } from '../application/use-cases/list-my-testable-repos.use-case';
import { AuthGuard } from '../infrastructure/guards/auth.guard';
import { AdminGuard } from '../infrastructure/guards/admin.guard';
import { ERepoAuthorizationStatus } from '../domain/constant/repo-authorization-status.constant';
import { IAuthenticatedUser } from '../domain/types/user.type';

type TAuthedRequest = Request & { user: IAuthenticatedUser };

@Controller('repo-authorizations')
export class RepoAuthorizationsController {
  constructor(
    private readonly submitRepoAuthorization: SubmitRepoAuthorizationUseCase,
    private readonly listMyRepoAuthorizations: ListMyRepoAuthorizationsUseCase,
    private readonly listAllRepoAuthorizations: ListAllRepoAuthorizationsUseCase,
    private readonly decideRepoAuthorization: DecideRepoAuthorizationUseCase,
    private readonly listMyTestableRepos: ListMyTestableReposUseCase,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  async submit(
    @Req() req: TAuthedRequest,
    @Body('owner') owner: string,
    @Body('name') name: string,
    @Body('note') note?: string,
  ) {
    return this.submitRepoAuthorization.execute(req.user.id, owner, name, note ?? null);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  async mine(@Req() req: TAuthedRequest) {
    return this.listMyRepoAuthorizations.execute(req.user.id);
  }

  @Get('mine/testable-repos')
  @UseGuards(AuthGuard)
  async testableRepos(@Req() req: TAuthedRequest) {
    return this.listMyTestableRepos.execute(req.user.id);
  }

  @Get()
  @UseGuards(AdminGuard)
  async all(@Query('status') status?: string) {
    if (status && !Object.values(ERepoAuthorizationStatus).includes(status as ERepoAuthorizationStatus)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    return this.listAllRepoAuthorizations.execute(status as ERepoAuthorizationStatus | undefined);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async decide(
    @Req() req: TAuthedRequest,
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('adminNote') adminNote?: string,
  ) {
    if (!Object.values(ERepoAuthorizationStatus).includes(status as ERepoAuthorizationStatus)) {
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
