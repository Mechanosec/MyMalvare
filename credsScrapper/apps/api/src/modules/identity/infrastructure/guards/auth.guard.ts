import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { TokenPort } from '../../application/ports/token.port';
import { IAuthenticatedUser } from '../../domain/types/authenticated-user.type';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly token: TokenPort) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: IAuthenticatedUser }>();
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const user = bearer ? this.token.verify(bearer) : null;
    if (!user) {
      throw new UnauthorizedException('Missing or invalid token');
    }
    request.user = user;
    return true;
  }
}
