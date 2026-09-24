import type { AnalyzeResult, Mode, Observation, Status } from '../shared/contracts';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createController } = require('../dist/test/controller.js');

function setup() {
  const window = new JSDOM(`<main role="main"><h2 class="hP">Subject</h2>
    <div class="adn ads" data-legacy-message-id="one"><span class="gD" email="one@example.org">One</span><div class="a3s aiL">First</div></div>
    <div class="adn ads" data-legacy-message-id="two"><span class="gD" email="two@example.org">Two</span><div class="a3s aiL">Second</div></div></main>`, { url: 'https://mail.google.com/mail/u/0/#inbox/a' }).window;
  const settings: { serverUrl: string; mode: Mode } = { serverUrl: 'http://127.0.0.1:8787', mode: 'jev' };
  const consents: Record<string, boolean> = {};
  const requests: { request: { requestId: string; mode: Mode }; callback: (response: unknown) => void }[] = [];
  const chromeApi = {
    storage: {
      sync: { get: async () => ({ ...settings }) },
      local: { get: async () => ({ consents: { ...consents } }), set: async (value: { consents: Record<string, boolean> }) => Object.assign(consents, value.consents) }
    },
    runtime: { sendMessage: (request: { requestId: string; mode: Mode }, callback: (response: unknown) => void) => requests.push({ request, callback }) }
  };
  const controller = createController({ document: window.document, chromeApi, route: () => window.location.href });
  return { window, settings, consents, requests, controller };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for UI update');
}

function verdict(request: { requestId: string; mode: Mode }, status: Status, observations: Observation[] = []): AnalyzeResult {
  return {
    requestId: request.requestId, mode: request.mode, model: 'synthetic', status,
    observations, limitations: [], elapsedMs: 1,
  };
}

test('asks consent before transmission and sends one request per expanded message', async () => {
  const ctx = setup();
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 0);
  assert.equal(ctx.window.document.querySelectorAll('.fishing-analizer button').length, 2);
  ctx.window.document.querySelector('.fishing-analizer button').click();
  await waitFor(() => ctx.requests.length === 2);
  assert.equal(ctx.requests.length, 2);
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 2);
});

test('out-of-order response never appears on another or replaced message', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 2);
  const first = ctx.window.document.querySelector('[data-legacy-message-id="one"]');
  first.querySelector('.a3s').textContent = 'Replaced';
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 3);
  ctx.requests[0].callback(verdict(ctx.requests[0].request, 'suspicious', [{ code: 'x', text: 'Old result' }]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(first.querySelector('.fishing-analizer').textContent, /Old result/);
  ctx.requests[2].callback(verdict(ctx.requests[2].request, 'review'));
  ctx.requests[1].callback(verdict(ctx.requests[1].request, 'no_signals'));
  await waitFor(() => first.querySelector('.fishing-analizer').textContent.includes('Зверніть увагу') &&
    ctx.window.document.querySelector('[data-legacy-message-id="two"] .fishing-analizer').textContent.includes('Все ок'));
  assert.match(first.querySelector('.fishing-analizer').textContent, /Зверніть увагу/);
  assert.match(ctx.window.document.querySelector('[data-legacy-message-id="two"] .fishing-analizer').textContent, /Все ок/);
});

test('route change prevents a late verdict from appearing in the old thread', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  await ctx.controller.scan();
  ctx.window.location.hash = '#inbox/other';
  ctx.requests[0].callback(verdict(ctx.requests[0].request, 'suspicious'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(ctx.window.document.querySelector('.fishing-analizer').textContent, /підозрілий/);
});

test('pending analysis is not sent twice when result cache fills up', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  const main = ctx.window.document.querySelector('[role="main"]');
  for (let id = 2; id < 101; id++) {
    const node = ctx.window.document.createElement('div');
    node.className = 'adn ads';
    node.setAttribute('data-legacy-message-id', String(id));
    node.innerHTML = `<span class="gD" email="test@example.org">Test</span><div class="a3s aiL">Message ${id}</div>`;
    main.append(node);
  }
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 101);
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 101);
});

test('mode change requires new consent and clears the old verdict', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  await ctx.controller.scan();
  ctx.requests[0].callback(verdict(ctx.requests[0].request, 'suspicious'));
  await new Promise(resolve => setTimeout(resolve, 0));
  ctx.settings.mode = 'local';
  await ctx.controller.scan();
  assert.equal(ctx.requests.length, 2);
  assert.match(ctx.window.document.querySelector('.fishing-analizer').textContent, /згоду/);
});

test('revoked consent blocks an in-flight verdict', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  await ctx.controller.scan();
  delete ctx.consents['http://127.0.0.1:8787|jev'];
  await ctx.controller.scan();
  ctx.requests[0].callback(verdict(ctx.requests[0].request, 'suspicious', [{ code: 'test', text: 'Stale verdict' }]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(ctx.window.document.body.textContent, /Stale verdict/);
});

test('changing the server blocks an in-flight verdict', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  await ctx.controller.scan();
  ctx.settings.serverUrl = 'http://localhost:8787';
  await ctx.controller.scan();
  ctx.requests[0].callback(verdict(ctx.requests[0].request, 'suspicious', [{ code: 'test', text: 'Stale verdict' }]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(ctx.window.document.body.textContent, /Stale verdict/);
});

test('server error shows no verdict and can be retried once', async () => {
  const ctx = setup();
  ctx.consents['http://127.0.0.1:8787|jev'] = true;
  await ctx.controller.scan();
  ctx.requests[0].callback({
    requestId: ctx.requests[0].request.requestId,
    error: { code: 'NETWORK_ERROR', message: 'Unavailable' },
  });
  const panel = ctx.window.document.querySelector('[data-legacy-message-id="one"] .fishing-analizer');
  await waitFor(() => panel.textContent.includes('Unavailable'));
  assert.equal(panel.querySelector('strong'), null);
  panel.querySelector('button').click();
  await waitFor(() => ctx.requests.length === 3);
  assert.equal(ctx.requests.length, 3);
});
