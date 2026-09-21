import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { GitCliAdapter } from '../../../src/modules/scanner/infrastructure/git/git-cli-adapter';

const execFileAsync = promisify(execFile);

async function run(cmd: string[], cwd: string): Promise<void> {
  await execFileAsync(cmd[0], cmd.slice(1), { cwd });
}

async function gitOutput(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args]);
  return stdout.trim();
}

describe('GitCliAdapter (real git, no mocks)', () => {
  let tmpDir: string;
  const adapter = new GitCliAdapter();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creds-git-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('prepares a one-commit shallow HEAD cache and a separate full history cache', async () => {
    const sourceDir = path.join(tmpDir, 'phased-source');
    await fs.mkdir(sourceDir);
    await run(['git', 'init', '-q'], sourceDir);
    await run(['git', 'config', 'user.email', 'test@example.com'], sourceDir);
    await run(['git', 'config', 'user.name', 'Test'], sourceDir);
    for (let revision = 1; revision <= 3; revision += 1) {
      await fs.writeFile(path.join(sourceDir, 'revision.txt'), `${revision}\n`);
      await run(['git', 'add', '.'], sourceDir);
      await run(['git', 'commit', '-qm', `revision ${revision}`], sourceDir);
    }
    const latestSha = await gitOutput(sourceDir, ['rev-parse', 'HEAD']);
    const signal = new AbortController().signal;

    const headDir = path.join(tmpDir, 'head-cache');
    expect(await adapter.prepareHead(sourceDir, headDir, signal)).toBe(
      latestSha,
    );
    expect(
      await gitOutput(headDir, ['rev-parse', '--is-shallow-repository']),
    ).toBe('true');
    const headDiffs = [];
    for await (const diff of adapter.iterCommitDiffs(headDir))
      headDiffs.push(diff);
    expect(headDiffs).toHaveLength(1);

    const historyDir = path.join(tmpDir, 'history-cache');
    await adapter.prepareHistory(sourceDir, historyDir, latestSha, signal);
    expect(await gitOutput(historyDir, ['rev-list', '--count', 'HEAD'])).toBe(
      '3',
    );
    expect(await adapter.getHeadCommit(historyDir)).toBe(latestSha);
  });

  it('clones, reads HEAD tree, and scans full commit history including a removed secret', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    await fs.mkdir(sourceDir);
    await run(['git', 'init'], sourceDir);
    await run(['git', 'config', 'user.email', 'test@example.com'], sourceDir);
    await run(['git', 'config', 'user.name', 'Test'], sourceDir);

    await fs.writeFile(
      path.join(sourceDir, 'config.py'),
      "SAFE = 'nothing here'\n",
    );
    await run(['git', 'add', 'config.py'], sourceDir);
    await run(['git', 'commit', '-m', 'initial commit'], sourceDir);

    await fs.writeFile(
      path.join(sourceDir, 'config.py'),
      "AWS_KEY = 'AKIAABCDEFGH12345678'\n",
    );
    await run(['git', 'add', 'config.py'], sourceDir);
    await run(['git', 'commit', '-m', 'oops, added a key'], sourceDir);

    await fs.writeFile(
      path.join(sourceDir, 'config.py'),
      "SAFE = 'nothing here'\n",
    );
    await run(['git', 'add', 'config.py'], sourceDir);
    await run(['git', 'commit', '-m', 'remove key'], sourceDir);

    const bareDir = path.join(tmpDir, 'bare');
    await adapter.cloneBare(sourceDir, bareDir);

    const headSha = await adapter.getHeadCommit(bareDir);
    expect(headSha).toHaveLength(40);

    const files = await adapter.listFilesAtHead(bareDir);
    expect(files).toEqual(['config.py']);

    const content = await adapter.readFileAtHead(bareDir, 'config.py');
    expect(content).toContain('SAFE');
    expect(content).not.toContain('AKIA');

    const diffs = [];
    for await (const diff of adapter.iterCommitDiffs(bareDir)) diffs.push(diff);
    expect(diffs).toHaveLength(3);
    expect(diffs.map((d) => d.diffText).join('\n')).toContain(
      'AKIAABCDEFGH12345678',
    );
  });

  it('handles a non-ASCII filename without crashing', async () => {
    const sourceDir = path.join(tmpDir, 'unicode-source');
    await fs.mkdir(sourceDir);
    await run(['git', 'init'], sourceDir);
    await run(['git', 'config', 'user.email', 'test@example.com'], sourceDir);
    await run(['git', 'config', 'user.name', 'Test'], sourceDir);

    const filename = '公告：头条.md';
    await fs.writeFile(
      path.join(sourceDir, filename),
      "AWS_KEY = 'AKIAABCDEFGH12345678'\n",
    );
    await run(['git', 'add', filename], sourceDir);
    await run(['git', 'commit', '-m', 'add unicode filename'], sourceDir);

    const bareDir = path.join(tmpDir, 'unicode-bare');
    await adapter.cloneBare(sourceDir, bareDir);

    const files = await adapter.listFilesAtHead(bareDir);
    expect(files).toEqual([filename]);

    const content = await adapter.readFileAtHead(bareDir, filename);
    expect(content).toContain('AKIAABCDEFGH12345678');
  });

  it('returns null (skips) for a binary file instead of throwing', async () => {
    const sourceDir = path.join(tmpDir, 'binary-source');
    await fs.mkdir(sourceDir);
    await run(['git', 'init'], sourceDir);
    await run(['git', 'config', 'user.email', 'test@example.com'], sourceDir);
    await run(['git', 'config', 'user.name', 'Test'], sourceDir);

    await fs.writeFile(
      path.join(sourceDir, 'image.png'),
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
      ]),
    );
    await run(['git', 'add', 'image.png'], sourceDir);
    await run(['git', 'commit', '-m', 'add binary file'], sourceDir);

    const bareDir = path.join(tmpDir, 'binary-bare');
    await adapter.cloneBare(sourceDir, bareDir);

    const content = await adapter.readFileAtHead(bareDir, 'image.png');
    expect(content).toBeNull();
  });

  it('never lets a credential prompt or helper run - disables all three paths on the clone command itself', async () => {
    // A candidate repo that's since gone private/renamed/deleted would
    // otherwise make git try to authenticate through any of three
    // independent mechanisms: its own terminal prompt (hangs forever
    // with no TTY attached), a configured credential.helper (can pop a
    // browser OAuth window on a dev machine with GitHub Desktop/gh CLI
    // installed), or GIT_ASKPASS - confirmed live in this repo's own dev
    // environment, where VS Code's integrated terminal sets it to its
    // own askpass script, which git invokes regardless of the other two
    // settings and pops an interactive "Username" prompt in the editor.
    // Swap in a fake `git` on PATH to inspect the real argv/env this
    // adapter invokes it with, without needing a real auth-requiring
    // git server (flaky and slow to simulate reliably in a test).
    const fakeBinDir = path.join(tmpDir, 'fake-bin');
    await fs.mkdir(fakeBinDir);
    const callLogPath = path.join(tmpDir, 'git-call.json');
    await fs.writeFile(
      path.join(fakeBinDir, 'git'),
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(callLogPath)}, JSON.stringify({ argv: process.argv.slice(2), env: { GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT, GIT_ASKPASS: process.env.GIT_ASKPASS, SSH_ASKPASS: process.env.SSH_ASKPASS } }));\n`,
    );
    await fs.chmod(path.join(fakeBinDir, 'git'), 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}:${originalPath}`;
    // Simulate VS Code's own environment injection, to prove our
    // override wins even when it's already set to something real.
    process.env.GIT_ASKPASS = '/fake/vscode-askpass.sh';
    try {
      await adapter.cloneBare(
        'https://github.com/example/private-repo.git',
        path.join(tmpDir, 'unused'),
      );
    } finally {
      process.env.PATH = originalPath;
      delete process.env.GIT_ASKPASS;
    }

    const call = JSON.parse(await fs.readFile(callLogPath, 'utf8'));
    expect(call.argv.slice(0, 2)).toEqual(['-c', 'credential.helper=']);
    expect(call.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(call.env.GIT_ASKPASS).toBe('');
    expect(call.env.SSH_ASKPASS).toBe('');
  });
  it('batch-reads exact bytes for unusual names, binary, empty, and large files', async () => {
    const repo = path.join(tmpDir, 'batch');
    await fs.mkdir(repo);
    await run(['git', 'init', '-q'], repo);
    await run(['git', 'config', 'user.email', 'local@example.invalid'], repo);
    await run(['git', 'config', 'user.name', 'Local'], repo);
    const entries = new Map<string, string | Buffer>([
      ['with space.txt', 'first\r\nsecond\r\n'],
      ['公告.txt', 'unicode: Привіт\n'],
      ['line\nbreak.txt', 'not a batch command\n'],
      ['empty.txt', ''],
      ['binary.dat', Buffer.from([1, 0, 2, 255])],
      ['large.txt', 'ordinary text\n'.repeat(20000)],
    ]);
    for (const [file, value] of entries)
      await fs.writeFile(path.join(repo, file), value);
    await run(['git', 'add', '.'], repo);
    await run(
      ['git', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'batch fixture'],
      repo,
    );
    const actual = [];
    for await (const entry of adapter.readFilesAtHead(repo, [
      ...entries.keys(),
    ]))
      actual.push(entry);
    for (const entry of actual)
      expect(entry.text).toEqual(
        await adapter.readFileAtHead(repo, entry.filePath),
      );
    expect(actual.map((entry) => entry.filePath)).toEqual([...entries.keys()]);
    expect(
      actual.find((entry) => entry.filePath === 'binary.dat')?.text,
    ).toBeNull();
    const selected = [];
    for await (const entry of adapter.readFilesAtHead(repo, ['empty.txt']))
      selected.push(entry);
    expect(selected).toEqual([{ filePath: 'empty.txt', text: '' }]);
    const missing = async () => {
      for await (const _ of adapter.readFilesAtHead(repo, ['absent'])) {
      }
    };
    await expect(missing()).rejects.toThrow('missing');
  });

  it('streams the same commit text as the previous buffered reader, including CRLF', async () => {
    const repo = path.join(tmpDir, 'history');
    await fs.mkdir(repo);
    await run(['git', 'init', '-q'], repo);
    await run(['git', 'config', 'user.email', 'local@example.invalid'], repo);
    await run(['git', 'config', 'user.name', 'Local'], repo);
    await run(['git', 'config', 'core.autocrlf', 'false'], repo);
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(repo, 'config.txt'),
        `revision=${i}\r\nUnicode: Привіт\r\n`,
      );
      await run(['git', 'add', '.'], repo);
      await run(
        ['git', '-c', 'commit.gpgsign=false', 'commit', '-qm', `change ${i}`],
        repo,
      );
    }
    const { stdout } = await execFileAsync('git', [
      '-C',
      repo,
      'log',
      '-p',
      '--full-history',
      '--reverse',
    ]);
    const matches = [...stdout.matchAll(/^commit ([0-9a-f]{40})(?: .*)?$/gm)];
    const expected = matches.map((match, i) => ({
      commitSha: match[1],
      diffText: stdout.slice(
        match.index! + match[0].length,
        matches[i + 1]?.index ?? stdout.length,
      ),
    }));
    const actual = [];
    for await (const diff of adapter.iterCommitDiffs(repo)) actual.push(diff);
    expect(actual).toEqual(expected);
  });

  it('propagates Git failures rather than reporting an empty successful history', async () => {
    const read = async () => {
      for await (const _ of adapter.iterCommitDiffs(tmpDir)) {
      }
    };
    await expect(read()).rejects.toThrow('Git process failed');
  });
});
