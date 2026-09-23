import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import test from 'node:test';
import { build } from 'esbuild';

test('evaluation worker returns separate model/backend timings from one Laya request', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ answers: { phishing_risk: { type: 'choice', choice: 'review' } } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const directory = await mkdtemp(path.join(tmpdir(), 'fishing-core-test-'));
  try {
    const outfile = path.join(directory, 'worker.mjs');
    await build({ entryPoints: [path.resolve('scripts/evaluate_core.ts')],
                  outfile, bundle: true, platform: 'node', format: 'esm' });
    const child = spawn(process.execPath, [outfile], {
      env: { ...process.env, LAYA_URL: `http://127.0.0.1:${address.port}/v1/systemone` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const linePromise = once(lines, 'line');
    child.stdin.end(JSON.stringify({ sender: { name: 'Test', email: 'test@example.org' },
      subject: 'Test', text: 'Hello.', links: [], attachments: [], truncated: false }) + '\n');
    const [line] = await linePromise;
    const result = JSON.parse(line as string) as Record<string, unknown>;
    assert.equal(result.laya, 'review');
    assert.equal(result.backend, 'review');
    assert.equal(requests, 1);
    assert.equal(typeof result.layaMs, 'number');
    assert.equal(typeof result.backendMs, 'number');
    assert.ok((result.backendMs as number) >= (result.layaMs as number));
    await once(child, 'close');
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
