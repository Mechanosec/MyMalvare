import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from '../../../../../src/modules/auth/infrastructure/guards/admin.guard';
import { TokenPort } from '../../../../../src/modules/auth/application/ports/token.port';
import { EUserRole } from '../../../../../src/modules/auth/domain/constant/user-role.constant';

function makeContext(authHeader?: string): ExecutionContext {
  const request: { headers: Record<string, string>; user?: unknown } = { headers: {} };
  if (authHeader) request.headers.authorization = authHeader;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  it('allows an admin user through', () => {
    const user = { id: 1, email: 'a@b.com', role: EUserRole.ADMIN };
    const token = { verify: jest.fn().mockReturnValue(user) } as unknown as TokenPort;
    const guard = new AdminGuard(token);
    expect(guard.canActivate(makeContext('Bearer good-token'))).toBe(true);
  });

  it('throws ForbiddenException for a non-admin user', () => {
    const user = { id: 1, email: 'a@b.com', role: EUserRole.USER };
    const token = { verify: jest.fn().mockReturnValue(user) } as unknown as TokenPort;
    const guard = new AdminGuard(token);
    expect(() => guard.canActivate(makeContext('Bearer good-token'))).toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException when not authenticated at all', () => {
    const token = { verify: jest.fn() } as unknown as TokenPort;
    const guard = new AdminGuard(token);
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });
});
