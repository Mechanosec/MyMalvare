import { MessageChannel } from 'node:worker_threads';

jest.mock('../../../../../src/modules/scanner/infrastructure/git/git-cli-adapter', () => ({
  GitCliAdapter: jest.fn().mockImplementation(() => ({
    cloneBare: jest.fn().mockResolvedValue(undefined),
    getHeadCommit: jest.fn().mockResolvedValue('a'.repeat(40)),
    listFilesAtHead: jest.fn().mockResolvedValue([]),
    readFileAtHead: jest.fn().mockResolvedValue(null),
    iterCommitDiffs: jest.fn().mockResolvedValue([]),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import runScanTask from '../../../../../src/modules/scanner/infrastructure/workers/scan.worker';

describe('scan.worker default export', () => {
  it('runs the scan and posts progress events on the given port, then resolves the result', async () => {
    const { port1, port2 } = new MessageChannel();
    const received: unknown[] = [];
    port1.on('message', (m) => received.push(m));

    const result = await runScanTask({
      repoRef: { repoId: 1, owner: 'octocat', name: 'hello-world' },
      cloneSource: 'https://example.com/repo.git',
      workdir: 'workdir/repo-1',
      port: port2,
    });

    // MessagePort delivers 'message' events via a macrotask (libuv), not a
    // microtask - the mocked GitCliAdapter resolves via microtasks only, so
    // runScanTask's returned promise can settle before port1's listener has
    // fired. Under this project's Jest/ts-jest setup a single setImmediate
    // isn't enough (an extra macrotask hop from Jest's own instrumentation);
    // two flushes reliably let pending deliveries land.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    port1.close();
    port2.close();
    expect(result).toEqual({ status: 'done', headSha: 'a'.repeat(40) });
    expect(received.length).toBeGreaterThan(0);
    expect((received[0] as any).type).toBe('progress');
  });
});
