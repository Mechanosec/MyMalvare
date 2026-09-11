import type { Finding as TPrismaFinding, ScannedRepo as TPrismaScannedRepo } from '@prisma/client';
import { ECandidateStatus } from '../../domain/constant/candidate-status.constant';
import { EScanStatus } from '../../domain/constant/scan-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import { IFindingRecord } from '../../domain/types/finding-record.type';
import { IRepoRef } from '../../domain/types/repo-ref.type';

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
  };
}

export function scannedRepoStatus(row: TPrismaScannedRepo): EScanStatus {
  return toScanStatus(row.status);
}
