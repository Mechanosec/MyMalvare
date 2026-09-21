import type {
  Finding as TPrismaFinding,
  Prisma,
  ScannedRepo as TPrismaScannedRepo,
} from '@prisma/client';
import { ECandidateStatus } from '../../domain/constant/candidate-status.constant';
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { EScanStatus } from '../../domain/constant/scan-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import {
  IFindingRecord,
  IFindingsRepoOption,
} from '../../domain/types/finding-record.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IScannedRepoRecord } from '../../domain/types/scanned-repo-record.type';

// Prisma models never leave this file's callers within infrastructure -
// use-cases and controllers only ever see plain domain types. SQLite has
// no native enum type (see schema.prisma's comment), so the status/
// secretType columns are plain strings at the DB layer; casting them
// into the domain enums happens exactly here, once, at the boundary.
export function toCandidateStatus(raw: string): ECandidateStatus {
  return raw as ECandidateStatus;
}

export function toScanStatus(raw: string): EScanStatus {
  return raw as EScanStatus;
}

export function toSecretType(raw: string): ESecretType {
  return raw as ESecretType;
}

export function toFindingStatus(raw: string): EFindingStatus {
  return raw as EFindingStatus;
}

export function parseLeakCommits(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

export function toRepoRef(row: {
  repoId: number;
  owner: string;
  name: string;
}): IRepoRef {
  return { repoId: row.repoId, owner: row.owner, name: row.name };
}

export function toFindingRecord(row: TPrismaFinding): IFindingRecord {
  return {
    id: row.id,
    repoId: row.repoId,
    owner: row.owner,
    name: row.name,
    filePath: row.filePath,
    commitSha: row.commitSha,
    secretType: toSecretType(row.secretType),
    secretValue: row.secretValue,
    lineNumber: row.lineNumber,
    context: row.context,
    foundAt: row.foundAt,
    status: toFindingStatus(row.status),
    checkedAt: row.checkedAt,
    testReason: row.testReason,
    leakCommits: parseLeakCommits(row.leakCommits),
  };
}

// SQLite's LIKE (what Prisma's `contains` compiles to on this connector)
// is already case-insensitive for ASCII by default - there is no `mode:
// "insensitive"` option to pass here (SQLite doesn't support it via
// Prisma, unlike Postgres/MySQL).
export function buildSearchConditions(
  search: string,
): Prisma.FindingWhereInput[] {
  const conditions: Prisma.FindingWhereInput[] = [
    { filePath: { contains: search } },
    { context: { contains: search } },
  ];

  const slashIndex = search.indexOf('/');
  if (slashIndex === -1) {
    conditions.push(
      { owner: { contains: search } },
      { name: { contains: search } },
    );
  } else {
    // "owner/name" style queries (how repos are shown in the UI) - match
    // each half against its own column rather than one column containing
    // the whole "owner/name" string, which no single column holds.
    conditions.push({
      owner: { contains: search.slice(0, slashIndex) },
      name: { contains: search.slice(slashIndex + 1) },
    });
  }

  return conditions;
}

export function scannedRepoStatus(row: TPrismaScannedRepo): EScanStatus {
  return toScanStatus(row.status);
}

// Collapses one row per (repoId, status) - the shape a `groupBy(['repoId',
// 'owner', 'name', 'status'])` returns - into one IFindingsRepoOption per
// repo, so the repo picker can show a status breakdown
// alongside the total, not just the total.
export function groupRepoOptionsByStatus(
  rows: ReadonlyArray<{
    repoId: number;
    owner: string;
    name: string;
    status: string;
    _count: { _all: number };
  }>,
): IFindingsRepoOption[] {
  const byRepo = new Map<
    number,
    { -readonly [K in keyof IFindingsRepoOption]: IFindingsRepoOption[K] }
  >();
  for (const row of rows) {
    let existing = byRepo.get(row.repoId);
    if (!existing) {
      existing = {
        repoId: row.repoId,
        owner: row.owner,
        name: row.name,
        count: 0,
        validCount: 0,
        invalidCount: 0,
        failedCount: 0,
        unknownCount: 0,
      };
      byRepo.set(row.repoId, existing);
    }
    existing.count += row._count._all;
    const status = toFindingStatus(row.status);
    if (status === EFindingStatus.VALID) {
      existing.validCount += row._count._all;
    } else if (status === EFindingStatus.INVALID) {
      existing.invalidCount += row._count._all;
    } else if (status === EFindingStatus.FAILED) {
      existing.failedCount += row._count._all;
    } else {
      existing.unknownCount += row._count._all;
    }
  }
  return [...byRepo.values()];
}

export function toScannedRepoRecord(
  row: TPrismaScannedRepo,
  findingsCount: number,
): IScannedRepoRecord {
  return {
    repoId: row.repoId,
    owner: row.owner,
    name: row.name,
    status: toScanStatus(row.status),
    lastCommitSha: row.lastCommitSha,
    startedAt: row.startedAt,
    scannedAt: row.scannedAt,
    failReason: row.failReason,
    retryCount: row.retryCount,
    findingsCount,
    headPhase: null,
    historyPhase: null,
  };
}
