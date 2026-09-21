import { Injectable } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { GitOutputReader } from './git-output-reader';
import { GitOperationsPort } from '../../application/ports/git-operations.port';
import { directoryBytes } from '../workers/scan-budget';

// Ported 1:1 from credsScrapper/app/scan/git_ops.py. Shells out to the
// system `git` binary rather than a JS git library, because the Python
// version already solved subtle git-specific correctness bugs this way -
// re-implementing git internals in a pure-JS library risks reintroducing
// them. Uses Node's built-in child_process (no execa/etc dependency
// needed for this) - execFile never spawns a shell, so there's no
// shell-injection surface regardless.
const execFileAsync = promisify(execFile);
const COMMIT_HEADER_RE = /^commit ([0-9a-f]{40})(?: .*)?$/;
const MAX_OBJECT_BYTES = 100 * 1024 * 1024;
const MAX_COMMIT_BYTES = 512 * 1024 * 1024;

// Drain stderr without retaining arbitrary repository content in error messages.
function gitProcess(args: string[], signal?: AbortSignal) {
  const child = spawn('git', args, {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume();
  child.stdin.on('error', () => {}); // EPIPE is reported by the process completion.
  const abort = () => {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      code === 0
        ? resolve()
        : reject(
            new Error(
              signal?.aborted
                ? 'Git operation cancelled'
                : `Git process failed (exit ${code})`,
            ),
          );
    });
  });
  // A consumer can be processing a yielded record when the process exits.
  void completion.catch(() => {});
  return { child, completion };
}

@Injectable()
export class GitCliAdapter extends GitOperationsPort {
  async getStorageBytes(repoPath: string): Promise<number> {
    return directoryBytes(repoPath);
  }
  async prepareHead(
    source: string,
    destDir: string,
    signal: AbortSignal,
  ): Promise<string> {
    const cloneSource = await this.localSourceUrl(source);
    await fs.rm(destDir, { recursive: true, force: true });
    await this.runAnonymousGit(
      [
        '-c',
        'credential.helper=',
        'clone',
        '--bare',
        '--depth=1',
        '--single-branch',
        '--no-tags',
        '--',
        cloneSource,
        destDir,
      ],
      signal,
    );
    return this.getHeadCommit(destDir);
  }

  async prepareHistory(
    source: string,
    destDir: string,
    targetSha: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!/^[0-9a-f]{40}$/.test(targetSha))
      throw new Error('Invalid history target');

    const sourceHash = createHash('sha256').update(source).digest('hex');
    const marker = path.join(destDir, 'scanner-source');
    let cacheMatches = false;
    try {
      cacheMatches = (await fs.readFile(marker, 'utf8')) === sourceHash;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!cacheMatches) {
      await fs.rm(destDir, { recursive: true, force: true });
      await this.runAnonymousGit(
        [
          '-c',
          'credential.helper=',
          'clone',
          '--bare',
          '--no-tags',
          '--',
          source,
          destDir,
        ],
        signal,
      );
      await fs.writeFile(marker, sourceHash, { mode: 0o600 });
    }

    await this.runAnonymousGit(
      [
        '-C',
        destDir,
        '-c',
        'credential.helper=',
        'fetch',
        '--no-tags',
        '--force',
        '--',
        source,
        targetSha,
      ],
      signal,
    );
    await this.runAnonymousGit(
      ['-C', destDir, 'update-ref', '--no-deref', 'HEAD', 'FETCH_HEAD'],
      signal,
    );
  }

  private async localSourceUrl(source: string): Promise<string> {
    if (source.includes('://')) return source;
    try {
      await fs.access(source);
      return pathToFileURL(path.resolve(source)).href;
    } catch {
      return source;
    }
  }

  private async runAnonymousGit(
    args: string[],
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const child = spawn('git', args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
        },
      });
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          if (!child.pid || child.exitCode !== null) return;
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        child.once('error', reject);
        child.once('close', (code) => {
          signal.removeEventListener('abort', abort);
          code === 0 ? resolve() : reject(new Error('git_failed'));
        });
      });
    } catch {
      if (signal.aborted) throw new Error('Git operation cancelled');
      throw new Error('repository_unavailable');
    }
  }

  async syncBare(source: string, destDir: string): Promise<void> {
    const sourceHash = createHash('sha256').update(source).digest('hex');
    const marker = path.join(destDir, 'scanner-source');
    let previous: string | null = null;
    try {
      previous = await fs.readFile(marker, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous === sourceHash) {
      try {
        await execFileAsync('git', [
          '-C',
          destDir,
          'rev-parse',
          '--verify',
          'HEAD',
        ]);
      } catch {
        previous = null;
      }
    }
    if (previous !== sourceHash) {
      // Only this dedicated cache path is disposable; never touch user clones.
      await fs.rm(destDir, { recursive: true, force: true });
      await this.cloneBare(source, destDir);
      await fs.writeFile(marker, sourceHash, { mode: 0o600 });
      return;
    }
    // Fetch the remote's current HEAD explicitly: bare clone does not configure
    // a normal remote-tracking refspec, and the default branch may have changed.
    try {
      await execFileAsync(
        'git',
        [
          '-C',
          destDir,
          '-c',
          'credential.helper=',
          'fetch',
          '--no-tags',
          '--force',
          '--',
          source,
          'HEAD',
        ],
        {
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: '',
            SSH_ASKPASS: '',
          },
        },
      );
      // Detach HEAD instead of accidentally changing the old default branch.
      const { stdout } = await execFileAsync('git', [
        '-C',
        destDir,
        'rev-parse',
        'FETCH_HEAD',
      ]);
      await execFileAsync('git', [
        '-C',
        destDir,
        'update-ref',
        '--no-deref',
        'HEAD',
        stdout.trim(),
      ]);
    } catch {
      throw new Error('Git cache fetch failed');
    }
  }

  async isAncestor(repoPath: string, commit: string): Promise<boolean> {
    if (!/^[0-9a-f]{40}$/.test(commit)) return false;
    try {
      await execFileAsync('git', [
        '-C',
        repoPath,
        'merge-base',
        '--is-ancestor',
        commit,
        'HEAD',
      ]);
      return true;
    } catch {
      return false;
    } // Missing/pruned/rewritten base requires a full scan.
  }
  async cloneBare(source: string, destDir: string): Promise<void> {
    // source is derived from GH Archive event data (owner/name we don't
    // control) - "--" stops git's own flag parsing so a value that
    // starts with "-" is always treated as a positional path/URL, never
    // as an injected option. Mirrors the same fix in the Python
    // reference (credsScrapper/app/scan/git_ops.py's clone_bare).
    //
    // We only ever clone public repos anonymously - never supply
    // credentials. A candidate that's since gone private/renamed/deleted
    // should fail cleanly (caught upstream, marks the repo failed), not
    // trigger any interactive credential prompt. Three independent paths
    // git can use to ask for one, all disabled here: (1) its own
    // terminal prompt (GIT_TERMINAL_PROMPT=0), (2) a configured
    // credential.helper - GitHub Desktop/gh CLI on a dev machine can pop
    // a browser OAuth window (-c credential.helper=), and (3) GIT_ASKPASS
    // - confirmed live in this repo's own dev environment: VS Code's
    // integrated terminal sets GIT_ASKPASS to its own askpass script,
    // which git invokes regardless of the other two settings, popping an
    // interactive "Username" prompt in the editor. Overriding it (and
    // SSH_ASKPASS, in case a candidate's source URL is ever ssh://) to
    // empty makes git treat "no askpass available" as fail-fast instead.
    await execFileAsync(
      'git',
      ['-c', 'credential.helper=', 'clone', '--bare', '--', source, destDir],
      {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
        },
      },
    );
  }

  async getHeadCommit(repoPath: string): Promise<string> {
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoPath,
      'rev-parse',
      'HEAD',
    ]);
    return stdout.trim();
  }

  async listFilesAtHead(repoPath: string): Promise<string[]> {
    // -z gives NUL-separated, unquoted paths. Without it, git quotes any
    // path containing non-ASCII bytes (wrapping it in "..." with \NNN
    // octal escapes) and that quoted text can't be fed back into
    // `git show HEAD:<path>` as a real path.
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoPath,
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      'HEAD',
    ]);
    return stdout.split('\0').filter((name) => name.length > 0);
  }

  async readFileAtHead(
    repoPath: string,
    filePath: string,
  ): Promise<string | null> {
    // Read as raw bytes first: file content is arbitrary (unlike git's
    // own text output from other commands), so a binary file - a PNG
    // starting with \x89, a compiled binary, a font - is not valid
    // UTF-8 and would otherwise crash the whole repo scan on a single
    // unrelated file. A NUL byte is the standard binary/text heuristic
    // (git itself uses the same check); skip such files rather than
    // scanning garbage.
    const { stdout: raw } = await execFileAsync(
      'git',
      ['-C', repoPath, 'show', `HEAD:${filePath}`],
      { encoding: 'buffer', maxBuffer: 1024 * 1024 * 100 },
    );
    if (raw.includes(0)) {
      return null;
    }
    return raw.toString('utf8');
  }

  async *readFilesAtHead(
    repoPath: string,
    filePaths: readonly string[],
  ): AsyncIterable<{ filePath: string; text: string | null }> {
    if (filePaths.length === 0) return;
    // Request object IDs, not HEAD:path, so even filenames containing newlines
    // cannot inject a second batch request. Preserve the caller's path order.
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoPath, 'ls-tree', '-r', '-z', 'HEAD'],
      {
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const objects = new Map<string, string>();
    for (const entry of stdout.split('\0')) {
      if (!entry) continue;
      const tab = entry.indexOf('\t');
      const [, , oid] = entry.slice(0, tab).split(' ');
      objects.set(entry.slice(tab + 1), oid);
    }
    const { child, completion } = gitProcess([
      '-C',
      repoPath,
      'cat-file',
      '--batch',
    ]);
    const reader = new GitOutputReader(child.stdout);
    try {
      for (let index = 0; index < filePaths.length; index += 1) {
        // A small request window amortizes pipe round trips without filling
        // both stdin and stdout and deadlocking on a large repository.
        if (index % 64 === 0) {
          const ids = filePaths.slice(index, index + 64).map((filePath) => {
            const oid = objects.get(filePath);
            if (!oid)
              throw new Error('Requested file is missing from the HEAD tree');
            return oid;
          });
          child.stdin.write(ids.join('\n') + '\n');
        }
        const filePath = filePaths[index];
        const oid = objects.get(filePath)!;
        const header = await reader.line();
        const match = /^([0-9a-f]+) blob ([0-9]+)$/.exec(header);
        if (!match || match[1] !== oid)
          throw new Error('Invalid Git batch object');
        const size = Number(match[2]);
        if (!Number.isSafeInteger(size) || size > MAX_OBJECT_BYTES) {
          throw new Error('Git file exceeds the 100 MiB scan limit');
        }
        const raw = await reader.bytes(size);
        const delimiter = await reader.bytes(1);
        if (delimiter[0] !== 10) throw new Error('Invalid Git batch delimiter');
        yield { filePath, text: raw.includes(0) ? null : raw.toString('utf8') };
      }
      child.stdin.end();
      await completion;
    } finally {
      child.stdin.destroy();
      child.stdout.destroy();
      if (child.exitCode === null) child.kill();
      await completion.catch(() => {});
    }
  }

  async *iterCommitDiffs(
    repoPath: string,
    sinceCommit?: string,
    signal?: AbortSignal,
  ): AsyncIterable<{ commitSha: string; diffText: string }> {
    if (sinceCommit && !/^[0-9a-f]{40}$/.test(sinceCommit))
      throw new Error('Invalid scan checkpoint');
    const { child, completion } = gitProcess(
      [
        '-C',
        repoPath,
        'log',
        '--no-color',
        '--no-ext-diff',
        '-p',
        '--full-history',
        '--reverse',
        ...(sinceCommit ? [`${sinceCommit}..HEAD`] : []),
      ],
      signal,
    );
    child.stdin.end();
    // Decode at byte boundaries and preserve CRLF inside file diffs. readline
    // normalizes it, which can change multiline detector input.
    const decoder = new StringDecoder('utf8');
    let remainder = '';
    async function* readLines() {
      for await (const chunk of child.stdout) {
        remainder += decoder.write(chunk);
        let start = 0;
        let end: number;
        while ((end = remainder.indexOf('\n', start)) >= 0) {
          yield remainder.slice(start, end + 1);
          start = end + 1;
        }
        remainder = remainder.slice(start);
        if (Buffer.byteLength(remainder) > MAX_COMMIT_BYTES)
          throw new Error('Git diff line exceeds scan limit');
      }
      remainder += decoder.end();
      if (remainder) yield remainder;
    }
    let commitSha: string | undefined;
    let parts: string[] = [];
    let bytes = 0;
    try {
      for await (const line of readLines()) {
        const header = COMMIT_HEADER_RE.exec(
          line.endsWith('\n') ? line.slice(0, -1) : line,
        );
        if (header) {
          if (commitSha) yield { commitSha, diffText: '\n' + parts.join('') };
          commitSha = header[1];
          parts = [];
          bytes = 0;
        } else if (commitSha) {
          bytes += Buffer.byteLength(line);
          if (bytes > MAX_COMMIT_BYTES)
            throw new Error('Git commit diff exceeds the 512 MiB scan limit');
          parts.push(line);
        }
      }
      await completion;
      if (commitSha) yield { commitSha, diffText: '\n' + parts.join('') };
    } finally {
      child.stdout.destroy();
      if (child.exitCode === null) child.kill();
      await completion.catch(() => {});
    }
  }
}
