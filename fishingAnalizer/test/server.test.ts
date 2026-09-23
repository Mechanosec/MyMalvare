const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createServer }: typeof import('node:http') = require('node:http');
const { createHandler }: typeof import('../backend/http') = require('../dist/backend/http.js');
import type { MailMessage, Observation, Status } from '../shared/contracts';

type TestBody = {
  requestId?: string;
  model?: string;
  status?: Status;
  observations?: Observation[];
  limitations?: string[];
  elapsedMs?: number;
  error?: { code: string; message: string };
};

const message = {
  sender: { name: 'Support', email: 'support@example.com' },
  subject: 'Review your account', text: 'Please review the account.',
  links: [{ text: 'https://example.com/login', url: 'https://other.example/login' }],
  attachments: [], truncated: false,
};

async function withServer(fetcher: typeof fetch, fn: (base: string) => Promise<void>, env: NodeJS.ProcessEnv = {}) {
  const server = createServer(createHandler({ fetcher, env }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Expected a TCP server');
  try { await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function post(base: string, body: unknown): Promise<[number, TestBody]> {
  const response = await fetch(`${base}/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return [response.status, await response.json()];
}

test('root explains that this address is the backend, not the extension UI', async () => {
  await withServer(async () => { throw Error('model should not be called'); }, async base => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    assert.match(html, /Fishing Analizer/);
    assert.match(html, /127\.0\.0\.1:8787/);
    assert.match(html, /Chrome/);
    assert.match(html, /Gmail/);
  });
});

test('Jev sends typed question to fixed OpenRouter URL and returns observed sign', async () => {
  let upstream: { url: string; init: RequestInit } | undefined;
  await withServer(async (url, init) => {
    assert.ok(init);
    upstream = { url: String(url), init };
    return new Response(JSON.stringify({ answers: { phishing_risk: { type: 'choice', choice: 'suspicious' } } }), { status: 200 });
  }, async base => {
    const [code, body] = await post(base, { requestId: 'r1', mode: 'jev', message });
    assert.equal(code, 200);
    assert.equal(body.requestId, 'r1');
    assert.equal(body.status, 'suspicious');
    assert.equal(body.model, 'typesafe/jev-1.13');
    assert.ok(body.observations?.some(x => x.code === 'link_label_mismatch'));
    assert.ok(body.limitations?.length);
    assert.equal(typeof body.elapsedMs, 'number');
  }, { OPENROUTER_API_KEY: 'synthetic-key' });
  assert.ok(upstream);
  assert.equal(upstream.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal((upstream.init.headers as Record<string, string>).Authorization, 'Bearer synthetic-key');
  assert.equal(upstream.init.redirect, 'error');
  const sent = JSON.parse(String(upstream.init.body));
  assert.equal(sent.model, 'typesafe/jev-1.13');
  assert.equal(sent.state.message.text, message.text);
  assert.equal(sent.questions.phishing_risk.type, 'choice');
});

test('local adapter uses the same state/questions and rejects a non-loopback endpoint', async () => {
  const requests: { url: string; body: { model: string; state: { message: MailMessage }; questions: { phishing_risk: { type: string } } } }[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ answers: { phishing_risk: { type: 'choice', choice: 'review' } } }), { status: 200 });
  };
  await withServer(fakeFetch, async base => {
    const [code, body] = await post(base, { requestId: 'r2', mode: 'local', message });
    assert.equal(code, 200);
    assert.equal(body.status, 'suspicious');
    assert.equal(body.model, 'laya-multilingual');
    assert.ok(body.limitations?.some(text => /1024/.test(text)));
  });
  assert.equal(requests[0].url, 'http://127.0.0.1:8000/v1/systemone');
  assert.equal(requests[0].body.model, 'multilingual');
  assert.equal(requests[0].body.state.message.text, message.text);
  assert.equal(requests[0].body.questions.phishing_risk.type, 'choice');
  await withServer(fakeFetch, async base => {
    const [code, body] = await post(base, { requestId: 'r3', mode: 'local', message });
    assert.equal(code, 503);
    assert.equal(body.error?.code, 'CONFIG_ERROR');
    assert.equal('status' in body, false);
  }, { LAYA_URL: 'http://evil.example/v1/systemone' });
  assert.equal(requests.length, 1);
});

test('truncated text never gets a no-signals verdict', async () => {
  await withServer(async () => new Response(JSON.stringify({ answers: { phishing_risk: { type: 'choice', choice: 'no_signals' } } }), { status: 200 }), async base => {
    const [code, body] = await post(base, { requestId: 'r8', mode: 'local', message: { ...message, links: [], truncated: true } });
    assert.equal(code, 200);
    assert.equal(body.status, 'review');
  });
});

test('preserves a suspicious model decision for a credential request without links', async () => {
  await withServer(async () => new Response(JSON.stringify({ answers: { phishing_risk: { type: 'choice', choice: 'suspicious' } } }), { status: 200 }), async base => {
    const [code, body] = await post(base, {
      requestId: 'r9', mode: 'jev', message: { ...message, text: 'Please enter your password now.', links: [] },
    });
    assert.equal(code, 200);
    assert.equal(body.status, 'suspicious');
    assert.ok(body.observations?.some(x => x.code === 'credential_request'));
  }, { OPENROUTER_API_KEY: 'synthetic-key' });
});

test('upstream failures and malformed answers never produce a verdict', async () => {
  await withServer(async () => new Response('{}', { status: 200 }), async base => {
    const [code, body] = await post(base, { requestId: 'r4', mode: 'local', message });
    assert.equal(code, 502);
    assert.equal(body.error?.code, 'UPSTREAM_ERROR');
    assert.equal('status' in body, false);
  });
  await withServer(async () => { throw Error('private upstream detail'); }, async base => {
    const [code, body] = await post(base, { requestId: 'r5', mode: 'local', message });
    assert.equal(code, 502);
    assert.equal(body.error?.code, 'UPSTREAM_ERROR');
    assert.doesNotMatch(JSON.stringify(body), /private upstream detail/);
  });
});

test('rejects invalid requests before contacting model', async () => {
  let called = false;
  await withServer(async () => { called = true; throw Error('model should not be called'); }, async base => {
    const [code, body] = await post(base, { requestId: 'r6', mode: 'local', message: { ...message, text: 'x'.repeat(40000) } });
    assert.equal(code, 400);
    assert.equal(body.error?.code, 'INVALID_REQUEST');
    assert.equal('status' in body, false);
  });
  assert.equal(called, false);
});

test('forwards only the agreed visible mail fields', async () => {
  let sent: MailMessage | undefined;
  await withServer(async (_url, init) => {
    sent = JSON.parse(String(init?.body)).state.message;
    return new Response(JSON.stringify({ answers: { phishing_risk: { type: 'choice', choice: 'no_signals' } } }), { status: 200 });
  }, async base => {
    const [code] = await post(base, {
      requestId: 'r7', mode: 'local',
      message: { ...message, hidden: 'synthetic private content', sender: { ...message.sender, unrelated: 'private' } },
    });
    assert.equal(code, 200);
  });
  assert.ok(sent);
  assert.equal('hidden' in sent, false);
  assert.equal('unrelated' in sent.sender, false);
});

test('rejects a non-extension Origin on the health route', async () => {
  await withServer(async () => { throw Error('model should not be called'); }, async base => {
    const response = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  });
});

test('health response identifies this backend for the launcher', async () => {
  await withServer(async () => { throw Error('model should not be called'); }, async base => {
    const response = await fetch(`${base}/health`);
    assert.deepEqual(await response.json(), { ok: true, service: 'fishingAnalizer' });
  });
});

test('rejects malformed JSON without a verdict', async () => {
  await withServer(async () => { throw Error('model should not be called'); }, async base => {
    const response = await fetch(`${base}/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.equal('status' in body, false);
  });
});
