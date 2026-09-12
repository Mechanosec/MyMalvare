import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitOperationsPort } from '../../application/ports/git-operations.port';

// Ported 1:1 from credsScrapper/app/scan/git_ops.py. Shells out to the
// system `git` binary rather than a JS git library, because the Python
// version already solved subtle git-specific correctness bugs this way -
// re-implementing git internals in a pure-JS library risks reintroducing
// them. Uses Node's built-in child_process (no execa/etc dependency
// needed for this) - execFile never spawns a shell, so there's no
// shell-injection surface regardless.
const execFileAsync = promisify(execFile);
const COMMIT_HEADER_RE = /^commit ([0-9a-f]{40})(?: .*)?$/gm;

@Injectable()
export class GitCliAdapter extends GitOperationsPort {
  async cloneBare(source: string, destDir: string): Promise<void> {
    // source is derived from GH Archive event data (owner/name we don't
    // control) - "--" stops git's own flag parsing so a value that
    // starts with "-" is always treated as a positional path/URL, never
    // as an injected option. Mirrors the same fix in the Python
    // reference (credsScrapper/app/scan/git_ops.py's clone_bare).
    await execFileAsync('git', ['clone', '--bare', '--', source, destDir]);
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

  async iterCommitDiffs(
    repoPath: string,
  ): Promise<Array<{ commitSha: string; diffText: string }>> {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoPath, 'log', '-p', '--full-history', '--reverse'],
      { maxBuffer: 1024 * 1024 * 100 },
    );
    const matches = [...stdout.matchAll(COMMIT_HEADER_RE)];
    const diffs: Array<{ commitSha: string; diffText: string }> = [];
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      const sha = match[1];
      const start = match.index! + match[0].length;
      const end =
        i + 1 < matches.length ? matches[i + 1].index! : stdout.length;
      diffs.push({ commitSha: sha, diffText: stdout.slice(start, end) });
    }
    return diffs;
  }
}
