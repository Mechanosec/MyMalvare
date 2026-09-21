import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitCliAdapter } from '../../../src/modules/scanner/infrastructure/git/git-cli-adapter';
import { FsScanCacheAdapter } from '../../../src/modules/scanner/infrastructure/fs/fs-scan-cache.adapter';
import {
  IScanJobEvent,
  RunScanJobUseCase,
} from '../../../src/modules/scanner/application/use-cases/run-scan-job.use-case';
import { IScanCheckpoint } from '../../../src/modules/scanner/application/types/scan-checkpoint.type';

const exec = promisify(execFile);
describe('Incremental scans (real Git and cache)', () => {
  let root: string;
  let source: string;
  const git = new GitCliAdapter();
  const ref = { repoId: 1, owner: 'local', name: 'fixture' };
  const command = (...args: string[]) => exec('git', ['-C', source, ...args]);
  const commit = async (text: string) => {
    await fs.writeFile(path.join(source, 'config.env'), text);
    await command('add', '.');
    await command('commit', '-qm', 'fixture update');
    return (await command('rev-parse', 'HEAD')).stdout.trim();
  };
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'incremental-scan-'));
    source = path.join(root, 'source');
    await fs.mkdir(source);
    await command('init', '-q');
    await command('config', 'user.name', 'Fixture');
    await command('config', 'user.email', 'fixture@example.invalid');
    await command('config', 'commit.gpgsign', 'false');
    await commit("VALUE='AKIAABCDEFGH12345678'\n");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function scan(checkpoint?: IScanCheckpoint, version = 'v1') {
    const events: IScanJobEvent[] = [];
    const result = await new RunScanJobUseCase(git).execute(
      ref,
      source,
      path.join(root, 'cache'),
      (event) => events.push(event),
      { reuseGit: true, scannerVersion: version, checkpoint },
    );
    expect(result.status).toBe('done');
    if (result.status !== 'done') throw new Error('scan failed');
    return {
      checkpoint: { headSha: result.headSha, scannerVersion: version },
      events,
    };
  }

  it('fetches without cloning again, skips unchanged HEAD, scans only new history but all current files', async () => {
    const clone = jest.spyOn(git, 'cloneBare');
    const initial = await scan();
    const unchanged = await scan(initial.checkpoint);
    expect(unchanged.events.filter((e) => e.type === 'finding')).toHaveLength(
      0,
    );
    const newSha = await commit("VALUE='AKIAABCDEFGH12345679'\n");
    const incremental = await scan(initial.checkpoint);
    const full: IScanJobEvent[] = [];
    await new RunScanJobUseCase(git).execute(
      ref,
      source,
      path.join(root, 'oracle'),
      (e) => full.push(e),
    );
    // Exact event equality for the new commit and HEAD, including removed values
    // in the diff, paths, line numbers and context.
    expect(incremental.events.filter((e) => e.type === 'finding')).toEqual(
      full.filter((e) => e.type === 'finding' && e.commitSha === newSha),
    );
    expect(clone).toHaveBeenCalledTimes(2); // first cache clone + full oracle only
    clone.mockRestore();
  });

  it('rescans all history when the detector changes, even with unchanged HEAD', async () => {
    const initial = await scan();
    const changed = await scan(initial.checkpoint, 'v2');
    expect(changed.events.filter((e) => e.type === 'finding')).toEqual(
      initial.events.filter((e) => e.type === 'finding'),
    );
  });

  it('falls back to full history on force-push and follows a changed default branch', async () => {
    const initial = await scan();
    await command('checkout', '--orphan', 'replacement');
    await commit("VALUE='AKIAABCDEFGH12345679'\n");
    const rewritten = await scan(initial.checkpoint);
    expect(rewritten.checkpoint.headSha).not.toBe(initial.checkpoint.headSha);
    expect(
      rewritten.events.some(
        (e) =>
          e.type === 'progress' && e.message.includes('full commit history'),
      ),
    ).toBe(true);
    expect(rewritten.events.filter((e) => e.type === 'finding')).toHaveLength(
      2,
    );
  });

  it('does not use stale results if fetch fails, and recovers from interrupted clone', async () => {
    const initial = await scan();
    await fs.rename(source, source + '-offline');
    const result = await new RunScanJobUseCase(git).execute(
      ref,
      source,
      path.join(root, 'cache'),
      () => {},
      { reuseGit: true, scannerVersion: 'v1', checkpoint: initial.checkpoint },
    );
    expect(result.status).toBe('failed');
    await fs.rename(source + '-offline', source);
    await fs.rm(path.join(root, 'cache', 'scanner-source'));
    const recovered = await scan(initial.checkpoint);
    expect(recovered.checkpoint).toEqual(initial.checkpoint);
  });

  it('reclones a cache when the source identity changes', async () => {
    await scan();
    const replacement = path.join(root, 'replacement');
    await exec('git', ['clone', '-q', source, replacement]);
    await git.syncBare(replacement, path.join(root, 'cache'));
    expect(
      (
        await exec('git', [
          '-C',
          path.join(root, 'cache'),
          'remote',
          'get-url',
          'origin',
        ])
      ).stdout.trim(),
    ).toBe(replacement);
  });

  it('locks across adapter instances, survives cache eviction, and invalidates version for a different source', async () => {
    const workdir = path.join(root, 'repo-1');
    const a = new FsScanCacheAdapter();
    const b = new FsScanCacheAdapter();
    const first = await a.acquire(workdir, source);
    try {
      await expect(b.acquire(workdir, source)).rejects.toThrow('locked');
    } finally {
      await first.release();
    }
    const second = await b.acquire(workdir, source);
    expect(second.repoPath).toBe(first.repoPath);
    expect(second.scannerVersion).toBe(first.scannerVersion);
    await second.release();
    const changed = await a.acquire(workdir, source + '-other');
    expect(changed.scannerVersion).not.toBe(first.scannerVersion);
    await changed.release();
  });

  it('evicts idle caches after seven days but never an actively locked cache', async () => {
    const adapter = new FsScanCacheAdapter();
    const idle = await adapter.acquire(path.join(root, 'idle'), source);
    await fs.mkdir(idle.repoPath);
    await idle.release();
    const active = await adapter.acquire(path.join(root, 'active'), source);
    await fs.mkdir(active.repoPath);
    const old = new Date(Date.now() - 8 * 86400000);
    await fs.utimes(idle.repoPath, old, old);
    await fs.utimes(active.repoPath, old, old);
    try {
      const fresh = await new FsScanCacheAdapter().acquire(
        path.join(root, 'fresh'),
        source,
      );
      await fresh.release();
      await expect(fs.stat(idle.repoPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect((await fs.stat(active.repoPath)).isDirectory()).toBe(true);
    } finally {
      await active.release();
    }
  });
});
