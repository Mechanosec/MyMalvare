import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { EUserRole } from '../../domain/constant/user-role.constant';
import { IAuthenticatedUser } from '../../domain/types/user.type';

@Injectable()
export class AdminGuard extends AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    super.canActivate(context); // throws UnauthorizedException if not authenticated
    const request = context.switchToHttp().getRequest<Request & { user: IAuthenticatedUser }>();
    if (request.user.role !== EUserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }
    return true;
  }
}
