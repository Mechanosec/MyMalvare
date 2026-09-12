import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PrismaStateRepository } from '../../../src/modules/scanner/infrastructure/persistence/prisma-state-repository';
import { PrismaService } from '../../../src/modules/scanner/infrastructure/persistence/prisma.service';

async function makeRepository(dbFile: string): Promise<{
  repo: PrismaStateRepository;
  prisma: PrismaService;
}> {
  // PrismaService inherits PrismaClient's constructor unchanged, so it
  // accepts the same datasources override - no need to touch DATABASE_URL.
  const prisma = new PrismaService({ datasources: { db: { url: `file:${dbFile}` } } });
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
      last_commit_sha TEXT, status TEXT NOT NULL, started_at DATETIME, scanned_at DATETIME,
      fail_reason TEXT, retry_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL, owner TEXT NOT NULL,
      name TEXT NOT NULL, file_path TEXT NOT NULL, commit_sha TEXT NOT NULL,
      secret_type TEXT NOT NULL, secret_value TEXT NOT NULL, line_number INTEGER,
      found_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, context TEXT,
      status TEXT NOT NULL DEFAULT 'unknown', leak_commits TEXT NOT NULL DEFAULT '[]'
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

  it('never lets two concurrent claimNext calls take the same repo', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    for (let i = 1; i <= 20; i += 1) {
      await repo.addCandidate(i, 'octocat', `repo${i}`);
    }

    const claims = await Promise.all(Array.from({ length: 20 }, () => repo.claimNext()));
    const claimedIds = claims
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => c.repoId);

    expect(claimedIds).toHaveLength(20);
    expect(new Set(claimedIds).size).toBe(20);

    await prisma.$disconnect();
  }, 20000);

  it('does not rescan a repo already marked done, and requeues a stale in_progress one', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

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

  it('groups repo options and secret-type counts correctly against a real DB', async () => {
    const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

    await repo.addFinding(1, 'octocat', 'repo1', 'a.py', 'sha', 'AWS_ACCESS_KEY_ID' as never, 'v1', 1, null);
    await repo.addFinding(1, 'octocat', 'repo1', 'b.py', 'sha', 'AWS_ACCESS_KEY_ID' as never, 'v2', 1, null);
    await repo.addFinding(2, 'someone', 'repo2', 'c.py', 'sha', 'GITHUB_PAT' as never, 'v', 1, null);

    const repoOptions = await repo.listFindingsRepoOptions(10);
    expect(repoOptions).toContainEqual({ repoId: 1, owner: 'octocat', name: 'repo1', count: 2 });
    expect(repoOptions).toContainEqual({ repoId: 2, owner: 'someone', name: 'repo2', count: 1 });

    const secretTypeCounts = await repo.listFindingsSecretTypeCounts();
    expect(secretTypeCounts).toContainEqual({ secretType: 'AWS_ACCESS_KEY_ID', count: 2 });
    expect(secretTypeCounts).toContainEqual({ secretType: 'GITHUB_PAT', count: 1 });

    await prisma.$disconnect();
  });

  describe('addFinding dedup', () => {
    it('inserts a fresh row with leakCommits seeded from the first commit', async () => {
      const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

      await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].leakCommits).toEqual(['head-sha']);
      expect(page.items[0].filePath).toBe('src/config.ts');

      await prisma.$disconnect();
    });

    it('promotes a diff-based finding to path-based when the same secret is later found at HEAD', async () => {
      const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

      await repo.addFinding(1, 'acme', 'widgets', '<commit-diff>', 'old-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 1, null);
      await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].filePath).toBe('src/config.ts');
      expect(page.items[0].commitSha).toBe('head-sha');
      expect([...page.items[0].leakCommits].sort()).toEqual(['head-sha', 'old-sha']);

      await prisma.$disconnect();
    });

    it('does not regress an already path-based finding when a diff-based match for the same secret arrives later', async () => {
      const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

      await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);
      await repo.addFinding(1, 'acme', 'widgets', '<commit-diff>', 'old-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 1, null);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].filePath).toBe('src/config.ts');
      expect([...page.items[0].leakCommits].sort()).toEqual(['head-sha', 'old-sha']);

      await prisma.$disconnect();
    });

    it('does not merge findings with different secret values', async () => {
      const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

      await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);
      await repo.addFinding(1, 'acme', 'widgets', 'src/other.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAZZZZZZZZ99999999', 1, null);

      const page = await repo.listFindings({ repoIds: [1] });
      expect(page.items).toHaveLength(2);

      await prisma.$disconnect();
    });
  });

  describe('updateFindingStatus', () => {
    it('persists the given status', async () => {
      const { repo, prisma } = await makeRepository(path.join(tmpDir, 'state.db'));

      await repo.addFinding(1, 'acme', 'widgets', 'src/config.ts', 'head-sha', 'AWS_ACCESS_KEY_ID' as never, 'AKIAABCDEFGH12345678', 3, null);
      const [before] = (await repo.listFindings({ repoIds: [1] })).items;

      await repo.updateFindingStatus(before.id, 'valid' as never);

      const [after] = (await repo.listFindings({ repoIds: [1] })).items;
      expect(after.status).toBe('valid');

      await prisma.$disconnect();
    });
  });
});
