const test = require('node:test');
const assert = require('node:assert/strict');
const { serverEndpoint, consentKey, readConsents, grantConsent, hasConsent } = require('../dist/test/settings.js');

test('accepts only a local backend root and preserves the consent key', () => {
  assert.equal(serverEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/analyze');
  assert.equal(serverEndpoint('http://localhost:8787/'), 'http://localhost:8787/analyze');
  assert.equal(serverEndpoint('http://127.0.0.1.evil.test:8787'), null);
  assert.equal(serverEndpoint('http://localhost:8787/path'), null);
  assert.equal(serverEndpoint('http://user:pass@localhost:8787'), null);
  assert.equal(consentKey({ serverUrl: 'http://localhost:8787', mode: 'local' }), 'http://localhost:8787|local');
});

test('ignores malformed stored consents', () => {
  assert.deepEqual(readConsents({ 'http://localhost:8787|jev': true, forged: 'yes' }), {
    'http://localhost:8787|jev': true,
  });
  assert.deepEqual(readConsents(null), {});
});

test('a late grant write cannot undo a later revocation', () => {
  const key = 'http://localhost:8787|local';
  const grantStartedBeforeRevoke = grantConsent({ consents: {}, consentGrantedAt: {} }, key, 100);
  const storage = { consents: {}, consentsRevokedAt: 200, consentGrantedAt: {} };
  Object.assign(storage, grantStartedBeforeRevoke);
  assert.equal(hasConsent(storage, key), false);
  assert.equal(hasConsent({
    consents: { [key]: true }, consentsRevokedAt: 200, consentGrantedAt: { [key]: 300 },
  }, key), true);
});
