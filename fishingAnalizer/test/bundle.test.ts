const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');
const { JSDOM } = require('jsdom');

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Content bundle did not update Gmail');
}

test('built content script works without globals and does not resend after its own DOM update', async () => {
  const window = new JSDOM(`<main role="main"><h2 class="hP">Subject</h2>
    <div class="adn ads" data-message-id="one"><span class="gD" email="one@example.org">One</span>
    <div class="a3s aiL">Hello</div></div></main>`, {
    url: 'https://mail.google.com/mail/u/0/#inbox/a', runScripts: 'outside-only',
  }).window;
  const consents: Record<string, boolean> = {};
  const requests: { request: { requestId: string }; callback: (response: unknown) => void }[] = [];
  Object.defineProperty(window, 'crypto', { value: webcrypto });
  window.TextEncoder = TextEncoder;
  window.chrome = {
    storage: {
      sync: { get: async () => ({ serverUrl: 'http://127.0.0.1:8787', mode: 'jev' }) },
      local: {
        get: async () => ({ consents: { ...consents } }),
        set: async (value: { consents: Record<string, boolean> }) => { Object.assign(consents, value.consents); },
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { sendMessage: (request: { requestId: string }, callback: (response: unknown) => void) => {
      requests.push({ request, callback });
    } },
  };

  try {
    assert.equal('FishingDom' in window, false);
    assert.equal('FishingController' in window, false);
    window.eval(readFileSync('dist/extection/content.js', 'utf8'));
    await waitFor(() => !!window.document.querySelector('.fishing-analizer button'));
    assert.equal(requests.length, 0);
    window.document.querySelector('.fishing-analizer button').click();
    await waitFor(() => requests.length === 1);
    requests[0].callback({
      requestId: requests[0].request.requestId, mode: 'jev', model: 'synthetic',
      status: 'review', observations: [], limitations: [], elapsedMs: 1,
    });
    await waitFor(() => window.document.querySelector('.fishing-analizer')?.textContent.includes('Зверніть увагу'));
    window.document.querySelector('.a3s').append(window.document.createTextNode(''));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(requests.length, 1);
    assert.equal('FishingDom' in window, false);
    assert.equal('FishingController' in window, false);
  } finally {
    window.close();
  }
});
