const test = require('node:test');
const assert = require('node:assert/strict');
const { replayResult, verifyCorpus, verifyCacheMetadata } = require('../scripts/benchmark_jev.cjs');

const message = {
  sender: { name: 'Sender', email: 'sender@example.org' },
  subject: 'Document', text: 'Here is the document.',
  links: [{ text: 'Open document', url: 'https://files.example.net/document' }],
  attachments: [], truncated: false,
};

test('replay updates an old backend status from the saved Jev choice without a provider call', async () => {
  const saved = { id: 'synthetic', choice: 'no_signals', status: 'review', label: 'ham' };
  const current = await replayResult(message, saved);
  assert.equal(current.status, 'no_signals');
  assert.equal(current.choice, 'no_signals');
  assert.equal(saved.status, 'review');
});

test('benchmark rejects a changed corpus even when its row count stays the same', () => {
  assert.throws(() => verifyCorpus('train', 'different-hash', 28305), /corpus/i);
});

test('benchmark refuses saved choices without matching model and question provenance', () => {
  const expected = {
    version: 1, split: 'test', corpusSha256: 'corpus',
    model: 'typesafe/jev-1.13', questionSha256: 'question',
  };
  assert.throws(() => verifyCacheMetadata(true, null, expected), /unverified/i);
  assert.throws(() => verifyCacheMetadata(true, { ...expected, questionSha256: 'other' }, expected), /unverified/i);
  assert.doesNotThrow(() => verifyCacheMetadata(true, expected, expected));
});
