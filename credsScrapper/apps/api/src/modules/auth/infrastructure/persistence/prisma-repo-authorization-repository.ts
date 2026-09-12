import { Injectable } from '@nestjs/common';
import { RepoAuthorizationRepositoryPort } from '../../application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../domain/constant/repo-authorization-status.constant';
import { IRepoAuthorization } from '../../domain/types/repo-authorization.type';
import { PrismaService } from '../../../scanner/infrastructure/persistence/prisma.service';

function toRecord(row: {
  id: number;
  userId: number;
  owner: string;
  name: string;
  note: string | null;
  status: string;
  adminNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedByUserId: number | null;
}): IRepoAuthorization {
  return { ...row, status: row.status as ERepoAuthorizationStatus };
}

@Injectable()
export class PrismaRepoAuthorizationRepository extends RepoAuthorizationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(userId: number, owner: string, name: string, note: string | null): Promise<IRepoAuthorization> {
    const row = await this.prisma.repoAuthorization.create({ data: { userId, owner, name, note } });
    return toRecord(row);
  }

  async listByUser(userId: number): Promise<readonly IRepoAuthorization[]> {
    const rows = await this.prisma.repoAuthorization.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async listAll(status?: ERepoAuthorizationStatus): Promise<readonly IRepoAuthorization[]> {
    const rows = await this.prisma.repoAuthorization.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async findById(id: number): Promise<IRepoAuthorization | null> {
    const row = await this.prisma.repoAuthorization.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async decide(
    id: number,
    status: ERepoAuthorizationStatus,
    adminNote: string | null,
    decidedByUserId: number,
  ): Promise<IRepoAuthorization | null> {
    try {
      const row = await this.prisma.repoAuthorization.update({
        where: { id },
        data: { status, adminNote, decidedAt: new Date(), decidedByUserId },
      });
      return toRecord(row);
    } catch {
      return null; // no row with that id
    }
  }
}
