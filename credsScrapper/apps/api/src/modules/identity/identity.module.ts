import { Module } from '@nestjs/common';
import { TokenPort } from './application/ports/token.port';
import { JwtTokenAdapter } from './infrastructure/security/jwt-token.adapter';
import { AuthGuard } from './infrastructure/guards/auth.guard';
import { AdminGuard } from './infrastructure/guards/admin.guard';

// No dependency on `auth` (users/registration) or `scanner` (findings) -
// pure "who is this request from, and are they an admin" concern, so both
// modules can depend on this one without a circular module import.
@Module({
  providers: [
    { provide: TokenPort, useClass: JwtTokenAdapter },
    { provide: AuthGuard, useFactory: (token: TokenPort) => new AuthGuard(token), inject: [TokenPort] },
    { provide: AdminGuard, useFactory: (token: TokenPort) => new AdminGuard(token), inject: [TokenPort] },
  ],
  exports: [TokenPort, AuthGuard, AdminGuard],
})
export class IdentityModule {}
