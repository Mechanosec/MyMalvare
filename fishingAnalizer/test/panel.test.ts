const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createPanel, renderPanel } = require('../dist/test/panel.js');

test('panel replaces an error with a verdict and keeps mail text inert', () => {
  const window = new JSDOM('').window;
  const panel = createPanel(window.document);
  let retried = false;
  renderPanel(panel, { kind: 'error', message: 'Network unavailable', onRetry: () => { retried = true; } });
  assert.equal(panel.querySelector('strong'), null);
  panel.querySelector('button').click();
  assert.equal(retried, true);

  renderPanel(panel, { kind: 'success', result: {
    requestId: 'r1', mode: 'jev', model: 'synthetic', status: 'review', elapsedMs: 1,
    observations: [{ code: 'test', text: '<img src=x onerror=alert(1)>' }], limitations: [],
  } });
  assert.match(panel.textContent, /потрібна перевірка/);
  assert.equal(panel.querySelector('img'), null);
  assert.equal(panel.querySelector('button'), null);
  window.close();
});
