import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StateRepositoryPort } from '../../application/ports/state-repository.port';
import { ECandidateStatus } from '../../domain/constant/candidate-status.constant';
import { EScanStatus } from '../../domain/constant/scan-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import {
  IFindingsFilter,
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
} from '../../domain/types/finding-record.type';
import { IQueueStatus } from '../../domain/types/queue-status.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../../domain/types/scanned-repo-record.type';
import { PrismaService } from './prisma.service';
import {
  buildSearchConditions,
  toFindingRecord,
  toRepoRef,
  toScannedRepoRecord,
  toScanStatus,
} from './prisma-state.mapper';

// Implements the same resumability semantics as
// credsScrapper/app/state/repository.py: candidates -> scanned_repos
// (pending -> in_progress -> done/failed), stale in_progress requeue,
// and a claim that never lets two callers take the same repo. Where
// Python used `BEGIN IMMEDIATE` to serialize OS-thread workers against
// one SQLite connection, this uses a Prisma interactive transaction -
// Node has no OS threads here, but two independent async worker loops
// could still interleave at an `await` boundary without one.
@Injectable()
export class PrismaStateRepository extends StateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async addCandidate(repoId: number, owner: string, name: string): Promise<boolean> {
    if (await this.isKnown(repoId)) {
      return false;
    }
    try {
      await this.prisma.candidate.create({
        data: { repoId, owner, name, status: ECandidateStatus.PENDING },
      });
      return true;
    } catch {
      // Lost a race with another writer between the isKnown check and
      // the insert (unique constraint violation) - already known now.
      return false;
    }
  }

  async isKnown(repoId: number): Promise<boolean> {
    const [candidate, scanned] = await Promise.all([
      this.prisma.candidate.findUnique({ where: { repoId } }),
      this.prisma.scannedRepo.findUnique({ where: { repoId } }),
    ]);
    return candidate !== null || scanned !== null;
  }

  async claimNext(): Promise<IRepoRef | null> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.findFirst({
        where: { status: ECandidateStatus.PENDING },
        orderBy: { discoveredAt: 'asc' },
      });
      if (candidate) {
        await tx.candidate.update({
          where: { repoId: candidate.repoId },
          data: { status: ECandidateStatus.CLAIMED },
        });
        await tx.scannedRepo.create({
          data: {
            repoId: candidate.repoId,
            owner: candidate.owner,
            name: candidate.name,
            status: EScanStatus.IN_PROGRESS,
            startedAt: new Date(),
            retryCount: 0,
          },
        });
        return toRepoRef(candidate);
      }

      const stalePending = await tx.scannedRepo.findFirst({
        where: { status: EScanStatus.PENDING },
        orderBy: { repoId: 'asc' },
      });
      if (!stalePending) {
        return null;
      }
      await tx.scannedRepo.update({
        where: { repoId: stalePending.repoId },
        data: { status: EScanStatus.IN_PROGRESS, startedAt: new Date() },
      });
      return toRepoRef(stalePending);
    });
  }

  async markDone(repoId: number, lastCommitSha: string): Promise<void> {
    await this.prisma.scannedRepo.update({
      where: { repoId },
      data: { status: EScanStatus.DONE, lastCommitSha, scannedAt: new Date() },
    });
  }

  async markFailed(repoId: number, reason: string): Promise<void> {
    await this.prisma.scannedRepo.update({
      where: { repoId },
      data: { status: EScanStatus.FAILED, failReason: reason, retryCount: { increment: 1 } },
    });
  }

  async requeueStale(timeoutSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000);
    const result = await this.prisma.scannedRepo.updateMany({
      where: { status: EScanStatus.IN_PROGRESS, startedAt: { lt: cutoff } },
      data: { status: EScanStatus.PENDING },
    });
    return result.count;
  }

  async addFinding(
    repoId: number,
    owner: string,
    name: string,
    filePath: string,
    commitSha: string,
    secretType: ESecretType,
    secretValue: string,
    lineNumber: number,
    context: string | null,
  ): Promise<void> {
    await this.prisma.finding.create({
      data: {
        repoId,
        owner,
        name,
        filePath,
        commitSha,
        secretType,
        secretValue,
        lineNumber,
        context,
      },
    });
  }

  async countFindings(repoId: number): Promise<number> {
    return this.prisma.finding.count({ where: { repoId } });
  }

  async getQueueStatus(): Promise<IQueueStatus> {
    const [pendingCandidates, grouped] = await Promise.all([
      this.prisma.candidate.count({ where: { status: ECandidateStatus.PENDING } }),
      this.prisma.scannedRepo.groupBy({ by: ['status'], _count: { status: true } }),
    ]);
    const scannedByStatus: Partial<Record<EScanStatus, number>> = {};
    for (const row of grouped) {
      scannedByStatus[toScanStatus(row.status)] = row._count.status;
    }
    return { pendingCandidates, scannedByStatus };
  }

  async listFindings(filter: IFindingsFilter): Promise<IFindingsPage> {
    const where: Prisma.FindingWhereInput = {
      secretType: filter.secretTypes?.length ? { in: [...filter.secretTypes] } : undefined,
      repoId: filter.repoIds?.length ? { in: [...filter.repoIds] } : undefined,
      ...(filter.search ? { OR: buildSearchConditions(filter.search) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.finding.findMany({
        where,
        orderBy: { foundAt: 'desc' },
        take: filter.limit ?? 100,
        skip: filter.offset ?? 0,
      }),
      this.prisma.finding.count({ where }),
    ]);
    return { items: rows.map(toFindingRecord), total };
  }

  async listFindingsRepoOptions(limit: number): Promise<IFindingsRepoOption[]> {
    const rows = await this.prisma.finding.groupBy({
      by: ['repoId', 'owner', 'name'],
      _count: { _all: true },
      orderBy: { _count: { repoId: 'desc' } },
      take: limit,
    });
    return rows.map((row) => ({
      repoId: row.repoId,
      owner: row.owner,
      name: row.name,
      count: row._count._all,
    }));
  }

  async listFindingsSecretTypeCounts(): Promise<ISecretTypeCount[]> {
    const rows = await this.prisma.finding.groupBy({
      by: ['secretType'],
      _count: { _all: true },
    });
    return rows.map((row) => ({
      secretType: row.secretType as ESecretType,
      count: row._count._all,
    }));
  }

  async listScannedRepos(limit: number): Promise<IScannedRepoRecord[]> {
    const rows = await this.prisma.scannedRepo.findMany({
      orderBy: [{ scannedAt: 'desc' }, { startedAt: 'desc' }],
      take: limit,
    });
    // No Prisma relation between scanned_repos and findings (repoId is a
    // plain column, not a foreign key) - one groupBy for all rows in this
    // page avoids an N+1 count-per-row.
    const counts = await this.prisma.finding.groupBy({
      by: ['repoId'],
      where: { repoId: { in: rows.map((row) => row.repoId) } },
      _count: { repoId: true },
    });
    const countByRepoId = new Map(counts.map((row) => [row.repoId, row._count.repoId]));
    return rows.map((row) => toScannedRepoRecord(row, countByRepoId.get(row.repoId) ?? 0));
  }
}
