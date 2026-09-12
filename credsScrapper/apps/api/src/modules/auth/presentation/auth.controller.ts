import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { RegisterUserUseCase } from '../application/use-cases/register-user.use-case';
import { LoginUserUseCase } from '../application/use-cases/login-user.use-case';
import { AuthGuard } from '../../identity/infrastructure/guards/auth.guard';
import { IAuthenticatedUser } from '../../identity/domain/types/authenticated-user.type';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly loginUser: LoginUserUseCase,
  ) {}

  @Post('register')
  async register(@Body('email') email: string, @Body('password') password: string) {
    let result;
    try {
      result = await this.registerUser.execute(email, password);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid email or password');
    }
    if (!result) {
      throw new UnauthorizedException('Email already registered');
    }
    return result;
  }

  @Post('login')
  async login(@Body('email') email: string, @Body('password') password: string) {
    const result = await this.loginUser.execute(email, password);
    if (!result) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return result;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: Request & { user: IAuthenticatedUser }) {
    return request.user;
  }
}
