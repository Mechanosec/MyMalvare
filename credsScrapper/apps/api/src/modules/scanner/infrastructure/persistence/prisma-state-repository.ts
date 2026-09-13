import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StateRepositoryPort } from '../../application/ports/state-repository.port';
import { ECandidateStatus } from '../../domain/constant/candidate-status.constant';
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { EScanStatus } from '../../domain/constant/scan-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import {
  IFindingInput,
  IFindingRecord,
  IFindingsFilter,
  IFindingsPage,
  IFindingsRepoOption,
  ISecretTypeCount,
  IStatusCount,
} from '../../domain/types/finding-record.type';
import { IQueueStatus } from '../../domain/types/queue-status.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../../domain/types/scanned-repo-record.type';
import { PrismaService } from './prisma.service';
import {
  buildSearchConditions,
  groupRepoOptionsByStatus,
  parseLeakCommits,
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

  async addCandidate(
    repoId: number,
    owner: string,
    name: string,
  ): Promise<boolean> {
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
      data: {
        status: EScanStatus.FAILED,
        failReason: reason,
        retryCount: { increment: 1 },
      },
    });
  }

  async startRepoScan(repoId: number, owner: string, name: string): Promise<void> {
    await this.prisma.scannedRepo.upsert({
      where: { repoId },
      create: { repoId, owner, name, status: EScanStatus.IN_PROGRESS, startedAt: new Date(), retryCount: 0 },
      update: { status: EScanStatus.IN_PROGRESS, startedAt: new Date() },
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

  async requeueFailed(maxRetries: number): Promise<number> {
    const result = await this.prisma.scannedRepo.updateMany({
      where: { status: EScanStatus.FAILED, retryCount: { lt: maxRetries } },
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
    const existing = await this.prisma.finding.findFirst({
      where: { repoId, secretType, secretValue },
    });

    if (!existing) {
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
          leakCommits: JSON.stringify([commitSha]),
        },
      });
      return;
    }

    const leakCommits = new Set<string>(parseLeakCommits(existing.leakCommits));
    leakCommits.add(commitSha);

    const isIncomingPathBased = filePath !== '<commit-diff>';
    const isExistingDiffBased = existing.filePath === '<commit-diff>';
    const shouldPromote = isIncomingPathBased && isExistingDiffBased;

    await this.prisma.finding.update({
      where: { id: existing.id },
      data: {
        leakCommits: JSON.stringify([...leakCommits]),
        ...(shouldPromote ? { filePath, commitSha, lineNumber, context } : {}),
      },
    });
  }

  async addFindings(
    repoId: number,
    owner: string,
    name: string,
    findings: readonly IFindingInput[],
  ): Promise<void> {
    if (findings.length === 0) {
      return;
    }

    interface IMergeState {
      readonly id?: number;
      readonly secretType: ESecretType;
      readonly secretValue: string;
      filePath: string;
      commitSha: string;
      lineNumber: number;
      context: string | null;
      readonly leakCommits: Set<string>;
      changed: boolean;
      // Whether filePath/commitSha/lineNumber/context were actually
      // (re)written during this call - distinct from `changed` (which
      // also covers a leakCommits-only update) so an existing row's real
      // values are never overwritten with this function's placeholder
      // seed values (commitSha: '', lineNumber: 0, context: null) below.
      promoted: boolean;
    }

    const byKey = new Map<string, IMergeState>();
    const keyOf = (secretType: string, secretValue: string) => `${secretType}|${secretValue}`;

    // One query for every finding this repo already has, instead of one
    // findFirst per incoming finding - a repo scan can produce hundreds of
    // thousands of findings, and that was turning "persist the results"
    // into a multi-minute tail after the scan itself had already finished.
    const existingRows = await this.prisma.finding.findMany({
      where: { repoId },
      select: { id: true, secretType: true, secretValue: true, filePath: true, leakCommits: true },
    });
    for (const row of existingRows) {
      byKey.set(keyOf(row.secretType, row.secretValue), {
        id: row.id,
        secretType: row.secretType as ESecretType,
        secretValue: row.secretValue,
        filePath: row.filePath,
        commitSha: '',
        lineNumber: 0,
        context: null,
        leakCommits: new Set(parseLeakCommits(row.leakCommits)),
        changed: false,
        promoted: false,
      });
    }

    // Same "does this new sighting add a commit, or upgrade a diff-based
    // placeholder to a real file path" merge addFinding always did - just
    // applied against an in-memory map instead of a DB round-trip per item,
    // and also covers duplicates arriving within this same batch (e.g. the
    // same secret appearing in both commit history and the working tree).
    for (const finding of findings) {
      const key = keyOf(finding.secretType, finding.secretValue);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          secretType: finding.secretType,
          secretValue: finding.secretValue,
          filePath: finding.filePath,
          commitSha: finding.commitSha,
          lineNumber: finding.lineNumber,
          context: finding.context,
          leakCommits: new Set([finding.commitSha]),
          changed: true,
          promoted: true,
        });
        continue;
      }

      const hadCommit = existing.leakCommits.has(finding.commitSha);
      existing.leakCommits.add(finding.commitSha);

      const isIncomingPathBased = finding.filePath !== '<commit-diff>';
      const isExistingDiffBased = existing.filePath === '<commit-diff>';
      if (isIncomingPathBased && isExistingDiffBased) {
        existing.filePath = finding.filePath;
        existing.commitSha = finding.commitSha;
        existing.lineNumber = finding.lineNumber;
        existing.context = finding.context;
        existing.changed = true;
        existing.promoted = true;
      } else if (!hadCommit) {
        existing.changed = true;
      }
    }

    const toInsert: Prisma.FindingCreateManyInput[] = [];
    const toUpdate: Array<{ id: number; data: Prisma.FindingUpdateInput }> = [];
    for (const state of byKey.values()) {
      if (state.id === undefined) {
        toInsert.push({
          repoId,
          owner,
          name,
          filePath: state.filePath,
          commitSha: state.commitSha,
          secretType: state.secretType,
          secretValue: state.secretValue,
          lineNumber: state.lineNumber,
          context: state.context,
          leakCommits: JSON.stringify([...state.leakCommits]),
        });
      } else if (state.changed) {
        toUpdate.push({
          id: state.id,
          data: {
            leakCommits: JSON.stringify([...state.leakCommits]),
            ...(state.promoted
              ? {
                  filePath: state.filePath,
                  commitSha: state.commitSha,
                  lineNumber: state.lineNumber,
                  context: state.context,
                }
              : {}),
          },
        });
      }
    }

    const CHUNK_SIZE = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      await this.prisma.finding.createMany({ data: toInsert.slice(i, i + CHUNK_SIZE) });
    }
    // A re-scan of an already-known noisy repo routes almost everything
    // through here instead of toInsert (same findings, new commit sighting)
    // - one update per row can't be avoided (each row's leakCommits/promoted
    // fields differ), but batching them into transactions instead of N
    // sequential awaits is still the same round-trip-count fix as toInsert.
    for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
      await this.prisma.$transaction(
        toUpdate
          .slice(i, i + CHUNK_SIZE)
          .map(({ id, data }) => this.prisma.finding.update({ where: { id }, data })),
      );
    }
  }

  async updateFindingStatus(id: number, status: EFindingStatus): Promise<void> {
    await this.prisma.finding.update({ where: { id }, data: { status } });
  }

  async recordTestResult(id: number, status: EFindingStatus): Promise<void> {
    await this.prisma.finding.update({ where: { id }, data: { status, checkedAt: new Date() } });
  }

  async countFindings(repoId: number): Promise<number> {
    return this.prisma.finding.count({ where: { repoId } });
  }

  async getQueueStatus(): Promise<IQueueStatus> {
    const [pendingCandidates, grouped] = await Promise.all([
      this.prisma.candidate.count({
        where: { status: ECandidateStatus.PENDING },
      }),
      this.prisma.scannedRepo.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
    ]);
    const scannedByStatus: Partial<Record<EScanStatus, number>> = {};
    for (const row of grouped) {
      scannedByStatus[toScanStatus(row.status)] = row._count.status;
    }
    return { pendingCandidates, scannedByStatus };
  }

  async listFindings(filter: IFindingsFilter): Promise<IFindingsPage> {
    const where: Prisma.FindingWhereInput = {
      secretType: filter.secretTypes?.length
        ? { in: [...filter.secretTypes] }
        : undefined,
      repoId: filter.repoIds?.length ? { in: [...filter.repoIds] } : undefined,
      status: filter.statuses?.length
        ? { in: [...filter.statuses] }
        : undefined,
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

  async getFindingById(id: number): Promise<IFindingRecord | null> {
    const row = await this.prisma.finding.findUnique({ where: { id } });
    return row ? toFindingRecord(row) : null;
  }

  async listFindingsRepoOptions(
    limit: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IFindingsRepoOption[]> {
    const rows = await this.prisma.finding.groupBy({
      by: ['repoId', 'owner', 'name', 'status'],
      where: secretTypes?.length ? { secretType: { in: [...secretTypes] } } : undefined,
      _count: { _all: true },
    });
    return groupRepoOptionsByStatus(rows)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async findFindingsRepoOptionsByOwnerName(
    pairs: ReadonlyArray<{ owner: string; name: string }>,
    secretTypes?: readonly ESecretType[],
  ): Promise<IFindingsRepoOption[]> {
    if (pairs.length === 0) {
      return [];
    }
    const wanted = new Set(pairs.map((p) => `${p.owner.toLowerCase()}/${p.name.toLowerCase()}`));
    const rows = await this.prisma.finding.groupBy({
      by: ['repoId', 'owner', 'name', 'status'],
      where: secretTypes?.length ? { secretType: { in: [...secretTypes] } } : undefined,
      _count: { _all: true },
    });
    return groupRepoOptionsByStatus(
      rows.filter((row) => wanted.has(`${row.owner.toLowerCase()}/${row.name.toLowerCase()}`)),
    );
  }

  async listFindingsSecretTypeCounts(repoId?: number): Promise<ISecretTypeCount[]> {
    const rows = await this.prisma.finding.groupBy({
      by: ['secretType'],
      where: repoId !== undefined ? { repoId } : undefined,
      _count: { _all: true },
    });
    return rows.map((row) => ({
      secretType: row.secretType as ESecretType,
      count: row._count._all,
    }));
  }

  async listFindingsStatusCounts(
    repoId?: number,
    secretTypes?: readonly ESecretType[],
  ): Promise<IStatusCount[]> {
    const rows = await this.prisma.finding.groupBy({
      by: ['status'],
      where: {
        repoId: repoId !== undefined ? repoId : undefined,
        secretType: secretTypes?.length ? { in: [...secretTypes] } : undefined,
      },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      status: row.status as EFindingStatus,
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
    const countByRepoId = new Map(
      counts.map((row) => [row.repoId, row._count.repoId]),
    );
    return rows.map((row) =>
      toScannedRepoRecord(row, countByRepoId.get(row.repoId) ?? 0),
    );
  }
}
