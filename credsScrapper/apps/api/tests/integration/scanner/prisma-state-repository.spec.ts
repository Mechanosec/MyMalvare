import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EFindingStatus } from '../../../src/modules/scanner/domain/constant/finding-status.constant';
import { PrismaStateRepository } from '../../../src/modules/scanner/infrastructure/persistence/prisma-state-repository';
import { PrismaService } from '../../../src/modules/scanner/infrastructure/persistence/prisma.service';

async function makeRepository(dbFile: string): Promise<{
  repo: PrismaStateRepository;
  prisma: PrismaService;
}> {
  // PrismaService inherits PrismaClient's constructor unchanged, so it
  // accepts the same datasources override - no need to touch DATABASE_URL.
  const prisma = new PrismaService({
    datasources: { db: { url: `file:${dbFile}` } },
  });
  // No `prisma migrate` in a test - lay down the same shape by hand
  // (equivalent to `prisma db push` for this fixed schema).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE candidates (
      repo_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
      discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, status TEXT NOT NULL DEFAULT 'pending'
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE scanned_repos (
      repo_id INTEGER PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
      last_commit_sha TEXT, scanner_version TEXT, status TEXT NOT NULL, started_at DATETIME, scanned_at DATETIME,
      fail_reason TEXT, retry_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, owner TEXT NOT NULL,
      name TEXT NOT NULL, file_path TEXT NOT NULL, commit_sha TEXT NOT NULL,
      secret_type TEXT NOT NULL, secret_value TEXT NOT NULL, line_number INTEGER,
      found_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, context TEXT,
      status TEXT NOT NULL DEFAULT 'unknown', checked_at DATETIME, leak_commits TEXT NOT NULL DEFAULT '[]'
    )
  `);
  return { repo: new PrismaStateRepository(prisma), prisma };
}

describe('PrismaStateRepository (real SQLite, no mocks)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creds-prisma-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps the last successful checkpoint across attempts and failures, and invalidates unversioned scans', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'checkpoint.db'),
    );
    try {
      await repo.startRepoScan(1, 'local', 'fixture');
      expect(await repo.getScanCheckpoint(1)).toBeNull();
      await repo.markDone(1, 'a'.repeat(40), 'scanner-v1');
      await repo.startRepoScan(1, 'local', 'fixture');
      await repo.markFailed(1, 'synthetic failure');
      expect(await repo.getScanCheckpoint(1)).toEqual({
        headSha: 'a'.repeat(40),
        scannerVersion: 'scanner-v1',
      });
      await repo.markDone(1, 'b'.repeat(40), 'scanner-v2');
      expect(await repo.getScanCheckpoint(1)).toEqual({
        headSha: 'b'.repeat(40),
        scannerVersion: 'scanner-v2',
      });
      await repo.markDone(1, 'c'.repeat(40));
      expect(await repo.getScanCheckpoint(1)).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });

  it('never lets two concurrent claimNext calls take the same repo', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'state.db'),
    );

    for (let i = 1; i <= 20; i += 1) {
      await repo.addCandidate(i, 'octocat', `repo${i}`);
    }

    const claims = await Promise.all(
      Array.from({ length: 20 }, () => repo.claimNext()),
    );
    const claimedIds = claims
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => c.repoId);

    expect(claimedIds).toHaveLength(20);
    expect(new Set(claimedIds).size).toBe(20);

    await prisma.$disconnect();
  }, 20000);

  it('does not rescan a repo already marked done, and requeues a stale in_progress one', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'state.db'),
    );

    await repo.addCandidate(1, 'octocat', 'repo1');
    const ref = await repo.claimNext();
    expect(ref).not.toBeNull();
    await repo.markDone(ref!.repoId, 'deadbeef');
    expect(await repo.claimNext()).toBeNull();

    await repo.addCandidate(2, 'octocat', 'repo2');
    const ref2 = await repo.claimNext();
    expect(ref2).not.toBeNull();
    // Backdate startedAt so requeueStale sees this as abandoned.
    await prisma.scannedRepo.update({
      where: { repoId: ref2!.repoId },
      data: { startedAt: new Date(Date.now() - 2 * 3600 * 1000) },
    });
    const requeued = await repo.requeueStale(3600);
    expect(requeued).toBe(1);
    expect(await repo.claimNext()).toEqual(ref2);

    await prisma.$disconnect();
  });

  it('requeues a failed repo below maxRetries, but not one that has hit it', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'state.db'),
    );

    await repo.addCandidate(1, 'octocat', 'repo1');
    await repo.claimNext();
    await repo.markFailed(1, 'stdout maxBuffer length exceeded');

    await repo.addCandidate(2, 'octocat', 'repo2');
    await repo.claimNext();
    await repo.markFailed(2, 'stdout maxBuffer length exceeded');
    await prisma.scannedRepo.update({
      where: { repoId: 2 },
      data: { retryCount: 3 },
    });

    const requeued = await repo.requeueFailed(3);
    expect(requeued).toBe(1);
    expect(await repo.claimNext()).toEqual({
      repoId: 1,
      owner: 'octocat',
      name: 'repo1',
    });
    expect(await repo.claimNext()).toBeNull();

    await prisma.$disconnect();
  });

  it('groups repo options and secret-type counts correctly against a real DB', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'state.db'),
    );

    await repo.addFinding(
      1,
      'octocat',
      'repo1',
      'a.py',
      'sha',
      'AWS_ACCESS_KEY_ID' as never,
      'v1',
      1,
      null,
    );
    await repo.addFinding(
      1,
      'octocat',
      'repo1',
      'b.py',
      'sha',
      'AWS_ACCESS_KEY_ID' as never,
      'v2',
      1,
      null,
    );
    await repo.addFinding(
      2,
      'someone',
      'repo2',
      'c.py',
      'sha',
      'GITHUB_PAT' as never,
      'v',
      1,
      null,
    );

    const repoOptions = await repo.listFindingsRepoOptions(10);
    expect(repoOptions).toContainEqual({
      repoId: 1,
      owner: 'octocat',
      name: 'repo1',
      count: 2,
      validCount: 0,
      invalidCount: 0,
      unknownCount: 2,
    });
    expect(repoOptions).toContainEqual({
      repoId: 2,
      owner: 'someone',
      name: 'repo2',
      count: 1,
      validCount: 0,
      invalidCount: 0,
      unknownCount: 1,
    });

    const secretTypeCounts = await repo.listFindingsSecretTypeCounts();
    expect(secretTypeCounts).toContainEqual({
      secretType: 'AWS_ACCESS_KEY_ID',
      count: 2,
    });
    expect(secretTypeCounts).toContainEqual({
      secretType: 'GITHUB_PAT',
      count: 1,
    });

    await prisma.$disconnect();
  });

  it('breaks down repo options by status (valid/invalid/unknown), not just a flat total', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'state.db'),
    );

    await repo.addFinding(
      1,
      'octocat',
      'repo1',
      'a.py',
      'sha',
      'AWS_ACCESS_KEY_ID' as never,
      'v1',
      1,
      null,
    );
    await repo.addFinding(
      1,
      'octocat',
      'repo1',
      'b.py',
      'sha',
      'GITHUB_PAT' as never,
      'v2',
      1,
      null,
    );
    await repo.addFinding(
      1,
      'octocat',
      'repo1',
      'c.py',
      'sha',
      'GITLAB_PAT' as never,
      'v3',
      1,
      null,
    );
    const page = await repo.listFindings({ repoIds: [1] });
    const [valid, invalid] = page.items;
    await repo.updateFindingStatus(valid.id, EFindingStatus.VALID);
    await repo.updateFindingStatus(invalid.id, EFindingStatus.INVALID);

    const [option] = await repo.listFindingsRepoOptions(10);
    expect(option).toEqual({
      repoId: 1,
      owner: 'octocat',
      name: 'repo1',
      count: 3,
      validCount: 1,
      invalidCount: 1,
      unknownCount: 1,
    });

    await prisma.$disconnect();
  });

  describe('addFinding dedup', () => {
    it('inserts a fresh row with leakCommits seeded from the first commit', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/config.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        3,
        null,
      );

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].leakCommits).toEqual(['head-sha']);
      expect(page.items[0].filePath).toBe('src/config.ts');

      await prisma.$disconnect();
    });

    it('promotes a diff-based finding to path-based when the same secret is later found at HEAD', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFinding(
        1,
        'acme',
        'widgets',
        '<commit-diff>',
        'old-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        1,
        null,
      );
      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/config.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        3,
        null,
      );

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].filePath).toBe('src/config.ts');
      expect(page.items[0].commitSha).toBe('head-sha');
      expect([...page.items[0].leakCommits].sort()).toEqual([
        'head-sha',
        'old-sha',
      ]);

      await prisma.$disconnect();
    });

    it('does not regress an already path-based finding when a diff-based match for the same secret arrives later', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/config.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        3,
        null,
      );
      await repo.addFinding(
        1,
        'acme',
        'widgets',
        '<commit-diff>',
        'old-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        1,
        null,
      );

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].filePath).toBe('src/config.ts');
      expect([...page.items[0].leakCommits].sort()).toEqual([
        'head-sha',
        'old-sha',
      ]);

      await prisma.$disconnect();
    });

    it('does not merge findings with different secret values', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/config.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        3,
        null,
      );
      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/other.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAZZZZZZZZ99999999',
        1,
        null,
      );

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(2);

      await prisma.$disconnect();
    });
  });

  describe('addFindings batch dedup', () => {
    it('inserts every finding in the batch', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFindings(1, 'acme', 'widgets', [
        {
          filePath: 'a.py',
          commitSha: 'sha1',
          secretType: 'AWS_ACCESS_KEY_ID' as never,
          secretValue: 'v1',
          lineNumber: 1,
          context: null,
        },
        {
          filePath: 'b.py',
          commitSha: 'sha1',
          secretType: 'GITHUB_PAT' as never,
          secretValue: 'v2',
          lineNumber: 1,
          context: null,
        },
      ]);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(2);

      await prisma.$disconnect();
    });

    it('merges two occurrences of the same secret within a single batch call, promoting to the path-based one', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFindings(1, 'acme', 'widgets', [
        {
          filePath: '<commit-diff>',
          commitSha: 'old-sha',
          secretType: 'AWS_ACCESS_KEY_ID' as never,
          secretValue: 'AKIAABCDEFGH12345678',
          lineNumber: 1,
          context: null,
        },
        {
          filePath: 'src/config.ts',
          commitSha: 'head-sha',
          secretType: 'AWS_ACCESS_KEY_ID' as never,
          secretValue: 'AKIAABCDEFGH12345678',
          lineNumber: 3,
          context: null,
        },
      ]);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].filePath).toBe('src/config.ts');
      expect(page.items[0].commitSha).toBe('head-sha');
      expect([...page.items[0].leakCommits].sort()).toEqual([
        'head-sha',
        'old-sha',
      ]);

      await prisma.$disconnect();
    });

    it('merges a batch against a pre-existing row without overwriting its real values with placeholders', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );
      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/config.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        3,
        'ctx',
      );

      // Same secret, seen again in a later commit - this should only add
      // to leakCommits, and must NOT clobber the existing path-based
      // filePath/commitSha/lineNumber/context with empty placeholder
      // values (the bug this test guards against).
      await repo.addFindings(1, 'acme', 'widgets', [
        {
          filePath: '<commit-diff>',
          commitSha: 'new-sha',
          secretType: 'AWS_ACCESS_KEY_ID' as never,
          secretValue: 'AKIAABCDEFGH12345678',
          lineNumber: 1,
          context: null,
        },
      ]);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].filePath).toBe('src/config.ts');
      expect(page.items[0].commitSha).toBe('head-sha');
      expect(page.items[0].lineNumber).toBe(3);
      expect(page.items[0].context).toBe('ctx');
      expect([...page.items[0].leakCommits].sort()).toEqual([
        'head-sha',
        'new-sha',
      ]);

      await prisma.$disconnect();
    });

    it('inserts correctly across the createMany chunk boundary (500 rows)', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      const findings = Array.from({ length: 1200 }, (_, i) => ({
        filePath: `file-${i}.py`,
        commitSha: 'sha',
        secretType: 'AWS_ACCESS_KEY_ID' as never,
        secretValue: `value-${i}`,
        lineNumber: 1,
        context: null,
      }));
      await repo.addFindings(1, 'acme', 'widgets', findings);

      const page = await repo.listFindings({ repoIds: [1], limit: 2000 });
      expect(page.total).toBe(1200);

      await prisma.$disconnect();
    });

    it('updates correctly across the transaction chunk boundary on a re-scan (600 pre-existing rows, each getting a new commit)', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      const firstScan = Array.from({ length: 600 }, (_, i) => ({
        filePath: `file-${i}.py`,
        commitSha: 'old-sha',
        secretType: 'AWS_ACCESS_KEY_ID' as never,
        secretValue: `value-${i}`,
        lineNumber: 1,
        context: null,
      }));
      await repo.addFindings(1, 'acme', 'widgets', firstScan);

      // Re-scan: same 600 secrets, seen again in a new commit - every one
      // of these routes through the toUpdate path, not toInsert.
      const rescan = firstScan.map((f) => ({ ...f, commitSha: 'new-sha' }));
      await repo.addFindings(1, 'acme', 'widgets', rescan);

      const page = await repo.listFindings({ repoIds: [1], limit: 1000 });
      expect(page.total).toBe(600);
      expect([...page.items[0].leakCommits].sort()).toEqual([
        'new-sha',
        'old-sha',
      ]);
      expect([...page.items[599].leakCommits].sort()).toEqual([
        'new-sha',
        'old-sha',
      ]);

      await prisma.$disconnect();
    });

    it('does nothing for an empty batch', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFindings(1, 'acme', 'widgets', []);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(0);

      await prisma.$disconnect();
    });
  });

  describe('updateFindingStatus', () => {
    it('persists the given status', async () => {
      const { repo, prisma } = await makeRepository(
        path.join(tmpDir, 'state.db'),
      );

      await repo.addFinding(
        1,
        'acme',
        'widgets',
        'src/config.ts',
        'head-sha',
        'AWS_ACCESS_KEY_ID' as never,
        'AKIAABCDEFGH12345678',
        3,
        null,
      );
      const [before] = (await repo.listFindings({ repoIds: [1] })).items;

      await repo.updateFindingStatus(before.id, 'valid' as never);

      const [after] = (await repo.listFindings({ repoIds: [1] })).items;
      expect(after.status).toBe('valid');

      await prisma.$disconnect();
    });
  });
  it('removes a directly scheduled repo from pending candidates atomically', async () => {
    const { repo, prisma } = await makeRepository(
      path.join(tmpDir, 'direct.db'),
    );
    try {
      await repo.addCandidate(1, 'local', 'direct');
      await repo.addCandidate(2, 'local', 'next');
      await repo.startRepoScan(1, 'local', 'direct');
      expect((await repo.claimNext())?.repoId).toBe(2);
      expect(await repo.claimNext()).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});
