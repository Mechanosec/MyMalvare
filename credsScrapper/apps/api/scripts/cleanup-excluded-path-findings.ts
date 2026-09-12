import { PrismaClient } from '@prisma/client';
import { isExcludedPath } from '../src/modules/scanner/domain/detection/path-exclusion';

// One-off cleanup for findings recorded before isExcludedPath existed -
// test/spec/e2e/fixture files scanned and stored back when nothing
// filtered them out. Reuses the same predicate the scanner now applies
// going forward, so "what gets deleted here" and "what gets skipped on
// the next scan" can never drift apart.
//
// Usage: npx ts-node scripts/cleanup-excluded-path-findings.ts [--apply]
// Without --apply, only reports what would be deleted (dry run).
async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const findings = await prisma.finding.findMany({ select: { id: true, filePath: true } });
    const toDelete = findings.filter((f) => isExcludedPath(f.filePath));

    if (toDelete.length === 0) {
      console.log('No findings match an excluded path. Nothing to do.');
      return;
    }

    console.log(`${toDelete.length} of ${findings.length} findings are under an excluded path:`);
    for (const f of toDelete.slice(0, 20)) {
      console.log(`  ${f.filePath}`);
    }
    if (toDelete.length > 20) {
      console.log(`  ...and ${toDelete.length - 20} more`);
    }

    if (!apply) {
      console.log('\nDry run - no rows deleted. Re-run with --apply to delete them.');
      return;
    }

    const { count } = await prisma.finding.deleteMany({
      where: { id: { in: toDelete.map((f) => f.id) } },
    });
    console.log(`\nDeleted ${count} findings.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
