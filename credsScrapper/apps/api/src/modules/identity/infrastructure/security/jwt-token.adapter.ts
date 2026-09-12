import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EUserRole } from '../../domain/constant/user-role.constant';
import { IAuthenticatedUser } from '../../domain/types/authenticated-user.type';
import { TokenPort } from '../../application/ports/token.port';

const EXPIRES_IN = '7d';

@Injectable()
export class JwtTokenAdapter extends TokenPort {
  private readonly secret: string;

  constructor() {
    super();
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set to a strong random value (32+ chars)');
    }
    this.secret = secret;
  }

  sign(payload: IAuthenticatedUser): string {
    return jwt.sign(payload, this.secret, { expiresIn: EXPIRES_IN });
  }

  verify(token: string): IAuthenticatedUser | null {
    try {
      const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;
      return { id: decoded.id as number, email: decoded.email as string, role: decoded.role as EUserRole };
    } catch {
      return null;
    }
  }
}
