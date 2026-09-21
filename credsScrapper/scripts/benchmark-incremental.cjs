// Synthetic local benchmark: compare the optimized full scan with persistent
// Git + checkpoint reuse. No remote calls and no real findings are read.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {createFixture} = require('./benchmark-scan.cjs');
const workspace = path.resolve(__dirname, '..');

async function round(index) {
  require(path.join(workspace, 'node_modules/ts-node')).register({project: path.join(workspace, 'apps/api/tsconfig.json'), transpileOnly: true, compilerOptions: {rootDir: workspace}});
  const moduleRoot = path.join(workspace, 'apps/api/src/modules/scanner');
  const {GitCliAdapter} = require(path.join(moduleRoot, 'infrastructure/git/git-cli-adapter'));
  const {FsScanCacheAdapter} = require(path.join(moduleRoot, 'infrastructure/fs/fs-scan-cache.adapter'));
  const {RunScanJobUseCase} = require(path.join(moduleRoot, 'application/use-cases/run-scan-job.use-case'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-incremental-bench-'));
  try {
    const source = createFixture(root, 'source', 150, 1, 0);
    const gitCommand = (...args) => execFileSync('git', ['-C', source, ...args], {stdio: 'pipe'});
    for (let i = 1; i < 250; i++) {
      fs.writeFileSync(path.join(source, 'config.env'), `VALUE='AKIAABCDEFGH1234567${i % 2 ? 8 : 9}'\n`.repeat(64));
      gitCommand('add', '.'); gitCommand('commit', '-qm', `fixture ${i}`);
    }
    const cache = new FsScanCacheAdapter();
    let checkpoint;
    const seen = {before: new Set(), after: new Set()};
    const results = [];
    for (const phase of ['first', 'unchanged', 'one-commit']) {
      if (phase === 'one-commit') {
        fs.writeFileSync(path.join(source, 'config.env'), "VALUE='AKIAABCDEFGH12345670'\n".repeat(64));
        gitCommand('add', '.'); gitCommand('commit', '-qm', 'new fixture commit');
      }
      const measurements = {};
      for (const variant of index % 2 ? ['after', 'before'] : ['before', 'after']) {
        const started = performance.now();
        const workdir = path.join(root, variant);
        let lease;
        let findings = 0;
        let result;
        try {
          if (variant === 'after') lease = await cache.acquire(workdir, source);
          else fs.rmSync(workdir, {recursive: true, force: true});
          result = await new RunScanJobUseCase(new GitCliAdapter()).execute(
            {repoId: 1, owner: 'local', name: 'fixture'}, source, lease?.repoPath ?? workdir,
            event => {if (event.type === 'finding') {findings++; seen[variant].add(JSON.stringify(event));}},
            lease ? {reuseGit: true, checkpoint, scannerVersion: lease.scannerVersion} : undefined);
          if (result.status !== 'done') throw new Error('Synthetic benchmark scan failed');
          if (lease) checkpoint = {headSha: result.headSha, scannerVersion: lease.scannerVersion};
        } finally { if (lease) await lease.release(); }
        measurements[variant] = {totalMs: performance.now() - started, emittedFindings: findings};
      }
      const fingerprint = variant => crypto.createHash('sha256').update([...seen[variant]].sort().join('\n')).digest('hex');
      if (fingerprint('before') !== fingerprint('after')) throw new Error(`Accumulated finding mismatch: ${phase}`);
      results.push({phase, ...measurements, identicalAccumulatedFindings: true, fingerprint: fingerprint('before')});
    }
    return results;
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

async function main() {
  if (process.argv[2] === '--round') {
    process.stdout.write(JSON.stringify(await round(Number(process.argv[3]))));
    return;
  }
  if (!process.argv[2]) throw new Error('Usage: node scripts/benchmark-incremental.cjs OUTPUT_JSON');
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(JSON.parse(execFileSync(process.execPath, [__filename, '--round', String(i)], {encoding: 'utf8', timeout: 180000})));
    console.log(`Round ${i + 1}: accumulated findings identical at every stage`);
  }
  fs.writeFileSync(process.argv[2], JSON.stringify({date: new Date().toISOString(), node: process.version,
    fixture: {files: 151, initialCommits: 250, addedCommits: 1},
    method: 'Three fresh processes; variant order alternates. Compare optimized full clone+scan with Git cache+fetch+checkpoint. Includes cache locking/version hashing; excludes network, Redis, DB, Piscina and TypeScript startup. Checkpoints simulated after successful scan. Compare accumulated complete finding events, not per-run output counts.', runs}, null, 2) + '\n');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
