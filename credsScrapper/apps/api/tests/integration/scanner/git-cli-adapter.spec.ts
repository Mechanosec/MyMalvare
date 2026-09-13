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

describe('GitCliAdapter (real git, no mocks)', () => {
  let tmpDir: string;
  const adapter = new GitCliAdapter();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'creds-git-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('clones, reads HEAD tree, and scans full commit history including a removed secret', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    await fs.mkdir(sourceDir);
    await run(['git', 'init'], sourceDir);
    await run(['git', 'config', 'user.email', 'test@example.com'], sourceDir);
    await run(['git', 'config', 'user.name', 'Test'], sourceDir);

    await fs.writeFile(path.join(sourceDir, 'config.py'), "SAFE = 'nothing here'\n");
    await run(['git', 'add', 'config.py'], sourceDir);
    await run(['git', 'commit', '-m', 'initial commit'], sourceDir);

    await fs.writeFile(path.join(sourceDir, 'config.py'), "AWS_KEY = 'AKIAABCDEFGH12345678'\n");
    await run(['git', 'add', 'config.py'], sourceDir);
    await run(['git', 'commit', '-m', 'oops, added a key'], sourceDir);

    await fs.writeFile(path.join(sourceDir, 'config.py'), "SAFE = 'nothing here'\n");
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

    const diffs = await adapter.iterCommitDiffs(bareDir);
    expect(diffs).toHaveLength(3);
    expect(diffs.map((d) => d.diffText).join('\n')).toContain('AKIAABCDEFGH12345678');
  });

  it('handles a non-ASCII filename without crashing', async () => {
    const sourceDir = path.join(tmpDir, 'unicode-source');
    await fs.mkdir(sourceDir);
    await run(['git', 'init'], sourceDir);
    await run(['git', 'config', 'user.email', 'test@example.com'], sourceDir);
    await run(['git', 'config', 'user.name', 'Test'], sourceDir);

    const filename = '公告：头条.md';
    await fs.writeFile(path.join(sourceDir, filename), "AWS_KEY = 'AKIAABCDEFGH12345678'\n");
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
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]),
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
      await adapter.cloneBare('https://github.com/example/private-repo.git', path.join(tmpDir, 'unused'));
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
});
