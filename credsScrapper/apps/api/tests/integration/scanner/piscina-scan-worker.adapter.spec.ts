import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PiscinaScanWorkerAdapter } from '../../../src/modules/scanner/infrastructure/workers/piscina-scan-worker.adapter';

const execFileAsync = promisify(execFile);

async function makeLocalRepoWithSecret(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piscina-test-repo-'));
  await execFileAsync('git', ['init', '-q', dir]);
  await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'config.py'), "AWS_KEY = 'AKIAABCDEFGH12345678'\n");
  await execFileAsync('git', ['-C', dir, 'add', '.']);
  await execFileAsync('git', ['-C', dir, 'commit', '-q', '-m', 'initial']);
  return dir;
}

describe('PiscinaScanWorkerAdapter (real worker threads)', () => {
  let adapter: PiscinaScanWorkerAdapter;
  let sourceRepo: string;
  let workdir: string;

  beforeAll(async () => {
    adapter = new PiscinaScanWorkerAdapter();
    sourceRepo = await makeLocalRepoWithSecret();
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'piscina-test-workdir-'));
    await fs.rmdir(workdir); // cloneBare needs the destination to not exist yet
  });

  afterAll(async () => {
    await adapter.close();
    await fs.rm(sourceRepo, { recursive: true, force: true });
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it('clones, scans, and finds the seeded secret via a real worker thread', async () => {
    const events: unknown[] = [];
    const result = await adapter.run(
      { repoId: 1, owner: 'test', name: 'repo' },
      sourceRepo,
      workdir,
      (event) => events.push(event),
    );

    expect(result.status).toBe('done');
    // RunScanJobUseCase (Task 2) scans commit diffs and the working tree
    // at HEAD as two separate passes, so a secret present since the
    // repo's one commit and still on disk is legitimately reported
    // twice - once per pass, each tagged with its own filePath. This
    // isn't a Piscina/thread timing artifact: it reproduces with the
    // same two events on every run.
    const findingEvents = events.filter((e: any) => e.type === 'finding');
    expect(findingEvents).toHaveLength(2);
    expect(
      findingEvents.map((e: any) => e.filePath).sort(),
    ).toEqual(['<commit-diff>', 'config.py']);
    for (const event of findingEvents) {
      expect((event as any).finding.secretValue).toBe('AKIAABCDEFGH12345678');
    }
  });
});
