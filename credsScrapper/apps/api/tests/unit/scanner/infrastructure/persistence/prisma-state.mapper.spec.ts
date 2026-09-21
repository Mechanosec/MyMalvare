import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import {
  groupRepoOptionsByStatus,
  toFindingRecord,
} from '../../../../../src/modules/scanner/infrastructure/persistence/prisma-state.mapper';

describe('groupRepoOptionsByStatus', () => {
  it('keeps failed findings separate from never-attempted unknown findings', () => {
    expect(
      groupRepoOptionsByStatus([
        {
          repoId: 1,
          owner: 'fixture',
          name: 'repo',
          status: 'unknown',
          _count: { _all: 2 },
        },
        {
          repoId: 1,
          owner: 'fixture',
          name: 'repo',
          status: 'failed',
          _count: { _all: 3 },
        },
      ]),
    ).toEqual([
      {
        repoId: 1,
        owner: 'fixture',
        name: 'repo',
        count: 5,
        validCount: 0,
        invalidCount: 0,
        failedCount: 3,
        unknownCount: 2,
      },
    ]);
  });
});

describe('toFindingRecord', () => {
  it('parses leakCommits JSON and casts status', () => {
    const row = {
      id: 1,
      repoId: 42,
      owner: 'acme',
      name: 'widgets',
      filePath: 'src/config.ts',
      commitSha: 'abc123',
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
      secretValue: 'AKIAABCDEFGH12345678',
      lineNumber: 3,
      context: null,
      foundAt: new Date('2026-01-01T00:00:00Z'),
      status: 'valid',
      leakCommits: '["abc123","def456"]',
    };

    const record = toFindingRecord(row as never);

    expect(record.status).toBe(EFindingStatus.VALID);
    expect(record.leakCommits).toEqual(['abc123', 'def456']);
  });

  it('falls back to an empty array for malformed leakCommits JSON', () => {
    const row = {
      id: 1,
      repoId: 42,
      owner: 'acme',
      name: 'widgets',
      filePath: 'src/config.ts',
      commitSha: 'abc123',
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
      secretValue: 'AKIAABCDEFGH12345678',
      lineNumber: null,
      context: null,
      foundAt: new Date('2026-01-01T00:00:00Z'),
      status: 'unknown',
      leakCommits: 'not-json',
    };

    const record = toFindingRecord(row as never);

    expect(record.leakCommits).toEqual([]);
  });
});
