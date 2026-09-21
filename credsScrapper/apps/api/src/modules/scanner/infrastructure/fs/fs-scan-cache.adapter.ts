import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ScanCachePort } from '../../application/ports/scan-cache.port';
import { EScanPhase } from '../../domain/constant/scan-phase.constant';

/** Linux flock releases the lock on process/pipe death; no stale PID stealing. */
async function lock(file: string): Promise<() => Promise<void>> {
  const child = spawn(
    'flock',
    [
      '--exclusive',
      '--nonblock',
      '--no-fork',
      file,
      // Fixed script, no interpolated paths/input. cat holds stdin open until
      // release/parent death, without starting another Node runtime per scan.
      '/bin/sh',
      '-c',
      'printf "locked\\n"; exec cat >/dev/null',
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', () =>
        reject(new Error('Cannot acquire scan cache lock: flock is required')),
      );
      child.once('exit', (code) =>
        reject(
          new Error(
            code === 1
              ? 'Scan cache is locked by another process'
              : 'Cannot start scan cache lock holder',
          ),
        ),
      );
      child.stdout.once('data', () => resolve());
    });
  } catch (error) {
    child.stdin.destroy();
    await closed;
    throw error;
  }
  return async () => {
    child.stdin.end();
    await closed;
  };
}

@Injectable()
export class FsScanCacheAdapter extends ScanCachePort {
  private readonly lastPruned = new Map<string, number>();

  private async prune(root: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastPruned.get(root) ?? 0) < 3600000) return;
    this.lastPruned.set(root, now);
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) continue;
      const dir = path.join(root, entry.name);
      let release: (() => Promise<void>) | undefined;
      try {
        if (now - (await fs.stat(dir)).mtimeMs < 7 * 86400000) continue;
        release = await lock(path.join(root, `${entry.name}.lock`));
        // Recheck under the lock; another scan might have just refreshed it.
        if (now - (await fs.stat(dir)).mtimeMs >= 7 * 86400000)
          await fs.rm(dir, { recursive: true, force: true });
      } catch {
        /* Busy or already removed entries can wait until next sweep. */
      } finally {
        await release?.();
      }
    }
  }

  async acquire(
    workdir: string,
    source: string,
    phase: EScanPhase = EScanPhase.HISTORY,
  ) {
    const root = path.join(
      path.dirname(path.resolve(workdir)),
      '.scan-cache',
      phase,
    );
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await this.prune(root);
    const key = createHash('sha256')
      .update(path.resolve(workdir))
      .digest('hex');
    const release = await lock(path.join(root, `${key}.lock`));
    try {
      // Hash executable scanner code automatically: rule/filter/parser changes
      // invalidate checkpoints without relying on a manually bumped version.
      const hash = createHash('sha256')
        .update('scan-cache-v1\0')
        .update(source);
      const moduleRoot = path.resolve(__dirname, '../..');
      async function hashDirectory(dir: string): Promise<void> {
        for (const entry of (
          await fs.readdir(dir, { withFileTypes: true })
        ).sort((a, b) => a.name.localeCompare(b.name))) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) await hashDirectory(file);
          else if (
            /\.(js|ts)$/.test(entry.name) &&
            !entry.name.endsWith('.d.ts')
          ) {
            hash
              .update(path.relative(moduleRoot, file))
              .update(await fs.readFile(file));
          }
        }
      }
      await hashDirectory(path.join(moduleRoot, 'domain'));
      const extension = __filename.endsWith('.ts') ? 'ts' : 'js';
      hash.update(
        await fs.readFile(
          path.join(
            moduleRoot,
            `application/use-cases/run-scan-job.use-case.${extension}`,
          ),
        ),
      );
      hash.update(
        await fs.readFile(
          path.join(
            moduleRoot,
            `infrastructure/git/git-cli-adapter.${extension}`,
          ),
        ),
      );
      const repoPath = path.join(root, key);
      // Existing entries are touched before work so eviction cannot steal a
      // recently acquired cache. First clone creates its directory itself.
      try {
        const now = new Date();
        await fs.utimes(repoPath, now, now);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      return { repoPath, scannerVersion: hash.digest('hex'), release };
    } catch (error) {
      await release();
      throw error;
    }
  }
}
