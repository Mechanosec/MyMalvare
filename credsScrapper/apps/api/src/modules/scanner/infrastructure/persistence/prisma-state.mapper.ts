import type {
  Finding as TPrismaFinding,
  Prisma,
  ScannedRepo as TPrismaScannedRepo,
} from '@prisma/client';
import { ECandidateStatus } from '../../domain/constant/candidate-status.constant';
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { EScanStatus } from '../../domain/constant/scan-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import { IFindingRecord } from '../../domain/types/finding-record.type';
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

function parseLeakCommits(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function toRepoRef(row: { repoId: number; owner: string; name: string }): IRepoRef {
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
    leakCommits: parseLeakCommits(row.leakCommits),
  };
}

// SQLite's LIKE (what Prisma's `contains` compiles to on this connector)
// is already case-insensitive for ASCII by default - there is no `mode:
// "insensitive"` option to pass here (SQLite doesn't support it via
// Prisma, unlike Postgres/MySQL).
export function buildSearchConditions(search: string): Prisma.FindingWhereInput[] {
  const conditions: Prisma.FindingWhereInput[] = [
    { filePath: { contains: search } },
    { context: { contains: search } },
  ];

  const slashIndex = search.indexOf('/');
  if (slashIndex === -1) {
    conditions.push({ owner: { contains: search } }, { name: { contains: search } });
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
  };
}
