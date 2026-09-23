const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageHandler } = require('../dist/test/background.js');

function fakeChrome(consented = true) {
  return {
    storage: {
      sync: { get: async () => ({ serverUrl: 'http://127.0.0.1:8787', mode: 'jev' }) },
      local: { get: async () => ({ consents: consented ? { 'http://127.0.0.1:8787|jev': true } : {} }) }
    }
  };
}

const sender = { url: 'https://mail.google.com/mail/u/0/#inbox/a' };
const request = { type: 'analyze', requestId: 'abc', mode: 'jev', message: { sender: { name: 'A', email: 'a@example.org' }, subject: 'Hi', text: 'Hello', links: [], attachments: [], truncated: false } };

test('requires consent before fetching', async () => {
  let calls = 0;
  const handler = createMessageHandler({ chromeApi: fakeChrome(false), fetcher: async () => { calls++; } });
  const result = await handler(request, sender);
  assert.equal(calls, 0);
  assert.equal(result.status, undefined);
  assert.equal(result.error.code, 'CONSENT_REQUIRED');
});

test('passes a valid response and rejects an upstream failure without a verdict', async () => {
  const handler = createMessageHandler({ chromeApi: fakeChrome(), fetcher: async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://127.0.0.1:8787/analyze');
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(String(init.body)).message.text, 'Hello');
    return { ok: true, json: async () => ({ requestId: 'abc', mode: 'jev', model: 'synthetic', status: 'review', observations: [], limitations: [], elapsedMs: 1 }) };
  } });
  assert.equal((await handler(request, sender)).status, 'review');
  const failed = createMessageHandler({ chromeApi: fakeChrome(), fetcher: async () => ({ ok: false, json: async () => ({ error: { code: 'UPSTREAM_ERROR', message: 'Unavailable' } }) }) });
  const result = await failed(request, sender);
  assert.equal(result.status, undefined);
  assert.equal(result.error.code, 'UPSTREAM_ERROR');
});

test('rejects non-loopback server addresses', async () => {
  const chromeApi = fakeChrome();
  chromeApi.storage.sync.get = async () => ({ serverUrl: 'http://127.0.0.1.evil.test:8787', mode: 'jev' });
  const result = await createMessageHandler({ chromeApi, fetcher: async () => { throw Error('must not fetch'); } })(request, sender);
  assert.equal(result.error.code, 'INVALID_SERVER');
});

test('network errors do not produce a verdict', async () => {
  const handler = createMessageHandler({ chromeApi: fakeChrome(), fetcher: async () => { throw Error('synthetic failure'); } });
  const result = await handler(request, sender);
  assert.equal('status' in result, false);
  assert.equal(result.error.code, 'NETWORK_ERROR');
});

test('rejects a server verdict for another mode', async () => {
  const handler = createMessageHandler({ chromeApi: fakeChrome(), fetcher: async () => ({
    ok: true, json: async () => ({
      requestId: 'abc', mode: 'local', model: 'synthetic', status: 'no_signals',
      observations: [], limitations: [], elapsedMs: 1,
    }),
  }) });
  const result = await handler(request, sender);
  assert.equal('status' in result, false);
  assert.equal(result.error.code, 'INVALID_RESPONSE');
});

test('never sends mail after revocation even if an earlier grant finishes last', async () => {
  const chromeApi = fakeChrome();
  chromeApi.storage.local.get = async () => ({
    consents: { 'http://127.0.0.1:8787|jev': true },
    consentGrantedAt: { 'http://127.0.0.1:8787|jev': 100 },
    consentsRevokedAt: 200,
  });
  let sent = false;
  const handler = createMessageHandler({ chromeApi, fetcher: async () => { sent = true; throw Error('must not send'); } });
  const result = await handler(request, sender);
  assert.equal(sent, false);
  assert.equal(result.error.code, 'CONSENT_REQUIRED');
});
