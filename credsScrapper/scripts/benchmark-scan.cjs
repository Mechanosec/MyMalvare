// Offline benchmark. Baseline must be a snapshot of the npm workspace containing
// apps/api/src, apps/api/tsconfig.json, and access to its node_modules.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const workspace = path.resolve(__dirname, '..');

async function measure(root, source, target) {
  require(path.join(workspace, 'node_modules/ts-node')).register({
    project: path.join(root, 'apps/api/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { rootDir: root },
  });
  const src = path.join(root, 'apps/api/src/modules/scanner');
  const engine = require(path.join(src, 'domain/detection/engine.ts'));
  const original = engine.scanText;
  let detectionMs = 0;
  engine.scanText = (text) => {
    const start = performance.now();
    try { return original(text); } finally { detectionMs += performance.now() - start; }
  };
  const { GitCliAdapter } = require(path.join(src, 'infrastructure/git/git-cli-adapter.ts'));
  const { RunScanJobUseCase } = require(path.join(src, 'application/use-cases/run-scan-job.use-case.ts'));
  const git = new GitCliAdapter();
  const phases = {};
  for (const method of ['cloneBare', 'getHeadCommit', 'listFilesAtHead', 'readFileAtHead', 'readFilesAtHead', 'iterCommitDiffs']) {
    if (!git[method]) continue;
    const fn = git[method].bind(git);
    phases[method] = 0;
    git[method] = (...args) => {
      const start = performance.now();
      const result = fn(...args);
      if (result[Symbol.asyncIterator]) {
        return (async function* () {
          const iterator = result[Symbol.asyncIterator]();
          try {
            for (;;) {
              const before = performance.now();
              const item = await iterator.next();
              phases[method] += performance.now() - before;
              if (item.done) return;
              yield item.value;
            }
          } finally { if (iterator.return) await iterator.return(); }
        })();
      }
      return Promise.resolve(result).finally(() => { phases[method] += performance.now() - start; });
    };
  }
  const hash = crypto.createHash('sha256');
  let findings = 0;
  const start = performance.now();
  const result = await new RunScanJobUseCase(git).execute(
    { repoId: 1, owner: 'local', name: 'benchmark' }, source, target,
    (event) => { if (event.type === 'finding') { findings++; hash.update(JSON.stringify(event)); } },
  );
  if (result.status !== 'done') throw new Error('Benchmark scan failed');
  return {
    totalMs: performance.now() - start,
    detectionMs,
    cloneMs: phases.cloneBare,
    headReadMs: phases.getHeadCommit + phases.listFilesAtHead + (phases.readFilesAtHead ?? phases.readFileAtHead ?? 0),
    historyReadMs: phases.iterCommitDiffs,
    findings,
    fingerprint: hash.digest('hex'),
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
  };
}

function createFixture(base, name, files, commits, denseLines) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'benchmark@example.invalid');
  git('config', 'user.name', 'Offline Benchmark');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  for (let i = 0; i < files; i++) {
    fs.writeFileSync(path.join(dir, `module-${i}.txt`), `// file ${i}\n` + 'const enabled = true; // ordinary configuration\n'.repeat(40));
  }
  // Published synthetic fixture value only; never contact a service with it.
  fs.writeFileSync(path.join(dir, 'config.env'), "VALUE='AKIAABCDEFGH12345678'\n");
  if (denseLines) {
    const lines = [];
    for (let i = 0; i < denseLines; i++) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const token = [...crypto.createHash('sha384').update(`synthetic-${i}`).digest()].map((byte) => alphabet[byte % alphabet.length]).join('');
      lines.push(`VALUE_${i}='AKIAABCDEFGH12345678' OTHER_${i}='${token}'`);
    }
    fs.writeFileSync(path.join(dir, 'many.env'), lines.join('\n') + '\n');
  }
  git('add', '.'); git('commit', '-qm', 'synthetic base');
  for (let i = 1; i < commits; i++) {
    fs.writeFileSync(path.join(dir, 'config.env'), i % 2 ? 'VALUE=removed\n' : "VALUE='AKIAABCDEFGH12345678'\n");
    git('add', '.'); git('commit', '-qm', `synthetic revision ${i}`);
  }
  return dir;
}

async function main() {
  if (process.argv[2] === '--measure') {
    const result = await measure(...process.argv.slice(3));
    process.stdout.write(JSON.stringify(result));
    return;
  }
  const baseline = process.argv[2];
  const output = process.argv[3];
  if (!baseline || !output) throw new Error('Usage: node scripts/benchmark-scan.cjs BASELINE_WORKSPACE OUTPUT_JSON');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-benchmark-'));
  try {
    const cases = [
      { name: 'many-files', files: 600, commits: 1, denseLines: 0 },
      { name: 'history', files: 80, commits: 80, denseLines: 0 },
      { name: 'many-findings', files: 5, commits: 2, denseLines: 6000 },
    ];
    const results = [];
    for (const fixture of cases) {
      const repo = createFixture(temp, fixture.name, fixture.files, fixture.commits, fixture.denseLines);
      const runs = { before: [], after: [] };
      for (let round = 0; round < 3; round++) {
        for (const variant of round % 2 ? ['after', 'before'] : ['before', 'after']) {
          const target = path.join(temp, `${fixture.name}-${variant}-${round}.git`);
          const raw = execFileSync(process.execPath, [__filename, '--measure', variant === 'before' ? path.resolve(baseline) : workspace, repo, target], { encoding: 'utf8', timeout: 120000 });
          runs[variant].push(JSON.parse(raw));
          fs.rmSync(target, { recursive: true, force: true });
        }
      }
      const fingerprints = new Set([...runs.before, ...runs.after].map((run) => run.fingerprint));
      if (fingerprints.size !== 1) throw new Error(`Detection results differ: ${fixture.name}`);
      results.push({ ...fixture, actualFiles: fixture.files + 1 + Number(fixture.denseLines > 0), identicalFindings: true, runs });
      console.log(`${fixture.name}: before/after findings identical`);
    }
    fs.writeFileSync(output, JSON.stringify({
      date: new Date().toISOString(), node: process.version,
      git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
      method: '3 fresh processes per variant, alternating order, same synthetic repos; local clone, Git I/O and detection; excludes network, Redis, DB and Piscina; peak RSS includes ts-node.',
      results,
    }, null, 2) + '\n');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { createFixture };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
