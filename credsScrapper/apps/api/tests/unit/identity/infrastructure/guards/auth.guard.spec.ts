import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../../../../../src/modules/identity/infrastructure/guards/auth.guard';
import { TokenPort } from '../../../../../src/modules/identity/application/ports/token.port';
import { EUserRole } from '../../../../../src/modules/identity/domain/constant/user-role.constant';

function makeContext(authHeader?: string): ExecutionContext {
  const request: { headers: Record<string, string>; user?: unknown } = { headers: {} };
  if (authHeader) request.headers.authorization = authHeader;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('attaches the decoded user and allows the request when the token is valid', () => {
    const user = { id: 1, email: 'a@b.com', role: EUserRole.USER };
    const token = { verify: jest.fn().mockReturnValue(user) } as unknown as TokenPort;
    const guard = new AuthGuard(token);
    const context = makeContext('Bearer good-token');

    expect(guard.canActivate(context)).toBe(true);
    expect(context.switchToHttp().getRequest().user).toEqual(user);
  });

  it('throws UnauthorizedException when the header is missing', () => {
    const token = { verify: jest.fn() } as unknown as TokenPort;
    const guard = new AuthGuard(token);
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token is invalid', () => {
    const token = { verify: jest.fn().mockReturnValue(null) } as unknown as TokenPort;
    const guard = new AuthGuard(token);
    expect(() => guard.canActivate(makeContext('Bearer bad-token'))).toThrow(UnauthorizedException);
  });
});
