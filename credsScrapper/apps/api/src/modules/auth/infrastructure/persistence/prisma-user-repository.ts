import { Injectable } from '@nestjs/common';
import { UserRepositoryPort } from '../../application/ports/user-repository.port';
import { EUserRole } from '../../../identity/domain/constant/user-role.constant';
import { IUser } from '../../domain/types/user.type';
import { PrismaService } from '../../../scanner/infrastructure/persistence/prisma.service';

@Injectable()
export class PrismaUserRepository extends UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createUser(email: string, passwordHash: string): Promise<IUser | null> {
    try {
      const row = await this.prisma.user.create({ data: { email, passwordHash } });
      return { ...row, role: row.role as EUserRole };
    } catch {
      return null; // unique constraint violation on email
    }
  }

  async findByEmail(email: string): Promise<IUser | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? { ...row, role: row.role as EUserRole } : null;
  }

  async findById(id: number): Promise<IUser | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? { ...row, role: row.role as EUserRole } : null;
  }
}
