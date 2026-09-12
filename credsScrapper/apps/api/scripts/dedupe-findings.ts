import { PrismaClient } from '@prisma/client';
import { parseLeakCommits } from '../src/modules/scanner/infrastructure/persistence/prisma-state.mapper';

// One-off cleanup for findings recorded before PrismaStateRepository.addFinding
// started deduping by (repoId, secretType, secretValue) - the same secret found
// via both a path-based scan and a commit-diff scan produced two separate rows.
// Merges each duplicate group into one row: prefers a path-based row (real
// filePath, not the '<commit-diff>' placeholder) as canonical, unions every
// group member's leakCommits (plus each member's own commitSha) onto it, then
// deletes the rest. Going-forward scans already dedup via addFinding; this
// only fixes rows that predate that logic.
//
// Loads every row once and groups in memory rather than querying per group -
// `findings` has no index on (repoId, secretType, secretValue), so a
// per-group findMany() is a full table scan and becomes unusably slow past a
// few thousand groups. All writes run inside one transaction so SQLite
// commits once instead of once per statement (the other reason a naive
// per-group loop crawls).
//
// Usage: npx ts-node scripts/dedupe-findings.ts [--apply]
// Without --apply, only reports what would be merged/deleted (dry run).
async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.finding.findMany({
      select: {
        id: true,
        repoId: true,
        secretType: true,
        secretValue: true,
        filePath: true,
        commitSha: true,
        leakCommits: true,
      },
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.repoId}|${row.secretType}|${row.secretValue}`;
      const existing = groups.get(key);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(key, [row]);
      }
    }

    const dupeGroups = [...groups.values()].filter((g) => g.length > 1);
    const totalDupeRows = dupeGroups.reduce((sum, g) => sum + g.length - 1, 0);

    if (dupeGroups.length === 0) {
      console.log('No duplicate findings. Nothing to do.');
      return;
    }
    console.log(`${dupeGroups.length} duplicate group(s), ${totalDupeRows} row(s) to merge away.`);

    if (!apply) {
      console.log('\nDry run - no rows changed. Re-run with --apply to merge and delete them.');
      return;
    }

    const updates: Array<{ id: number; leakCommits: string }> = [];
    const deleteIds: number[] = [];

    for (const group of dupeGroups) {
      const canonical = group.find((r) => r.filePath !== '<commit-diff>') ?? group[0];
      const others = group.filter((r) => r.id !== canonical.id);

      const leakCommits = new Set(parseLeakCommits(canonical.leakCommits));
      for (const other of others) {
        leakCommits.add(other.commitSha);
        for (const sha of parseLeakCommits(other.leakCommits)) {
          leakCommits.add(sha);
        }
        deleteIds.push(other.id);
      }
      updates.push({ id: canonical.id, leakCommits: JSON.stringify([...leakCommits]) });
    }

    console.log(`Applying ${updates.length} update(s) and ${deleteIds.length} delete(s) in one transaction...`);

    await prisma.$transaction(
      async (tx) => {
        for (const u of updates) {
          await tx.finding.update({ where: { id: u.id }, data: { leakCommits: u.leakCommits } });
        }
        const CHUNK = 500; // stay under SQLite's default 999-bound-variable limit per statement
        for (let i = 0; i < deleteIds.length; i += CHUNK) {
          await tx.finding.deleteMany({ where: { id: { in: deleteIds.slice(i, i + CHUNK) } } });
        }
      },
      { timeout: 10 * 60 * 1000 },
    );

    console.log(`\nDone. Merged ${dupeGroups.length} group(s), deleted ${deleteIds.length} duplicate row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
