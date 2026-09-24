// Run from fishingAnalizer after `npm run build`; output contains metadata only.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { loadEnvFile } = require('node:process');

// This evaluation is tied to the fixed corpus and exact Jev question used in the report.
const corpora = {
  test: { count: 51447, sha256: '31f2b1d1ec229139f4ea926fe18d690dc4c5561b111f6dc68b6b064fd293775c' },
  validation: { count: 4652, sha256: 'ce29aba492ce182890ae003501cb25346b067bc3b9ee67a5cb07bc00cf3136d6' },
  train: { count: 28305, sha256: 'be730020f8c9f78bb8b904a688c718ee18d7860a043aef3159cb046530b7d9d7' },
};
const questionSha256 = '24ab358d29b86639d06dc3b336a0ee5c065230ef4d03a9357e7374b577fd42b4';
const choices = new Set(['suspicious', 'review', 'no_signals']);

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function verifyCorpus(split, sourceHash, count) {
  const expected = corpora[split];
  if (!expected || count !== expected.count || sourceHash !== expected.sha256) {
    throw Error('Corpus differs from the pinned benchmark dataset');
  }
}

function verifyCacheMetadata(rawExists, actual, expected) {
  if ((rawExists && !actual) ||
      (actual && Object.keys(expected).some(key => actual[key] !== expected[key]))) {
    throw Error('Unverified Jev result cache; move it aside before a new benchmark');
  }
}

function verifyQuestion(options) {
  const body = JSON.parse(options.body);
  if (body.model !== 'typesafe/jev-1.13' || hash(JSON.stringify(body.questions)) !== questionSha256) {
    throw Error('Jev model or question differs from the benchmark');
  }
}

async function replayResult(message, saved) {
  if (!choices.has(saved.choice)) throw Error('Cannot replay an invalid Jev choice');
  const { analyze } = require('../dist/backend/analyze.js');
  const fetcher = async (_url, options) => {
    verifyQuestion(options);
    return new Response(JSON.stringify({ answers: {
      phishing_risk: { type: 'choice', choice: saved.choice },
    } }), { status: 200 });
  };
  const result = await analyze('jev', message, {
    fetcher, env: { OPENROUTER_API_KEY: 'local-replay-only' },
  });
  return { ...saved, status: result.status };
}

async function main() {
  const split = process.argv[2];
  if (!(split in corpora) || process.argv.slice(3).some(arg => arg !== '--dry-run')) {
    throw Error('Usage: node scripts/benchmark_jev.cjs <test|validation|train> [--dry-run]');
  }
  const corpus = `localModel/.cache/evaluation-trec-original/${split}.jsonl`;
  const rawName = split === 'test' ? 'full' : split;
  const rawOutput = `localModel/.cache/jev-${rawName}-results.jsonl`;
  const finalOutput = `localModel/.cache/jev-final-${split}-results.jsonl`;
  const source = fs.readFileSync(corpus, 'utf8');
  const rows = source.trimEnd().split('\n').map(line => JSON.parse(line));
  const sourceHash = hash(source);
  verifyCorpus(split, sourceHash, rows.length);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('Duplicate corpus ID');

  const metadataPath = `${rawOutput}.meta.json`;
  const expectedMetadata = {
    version: 1, split, corpusSha256: sourceHash,
    model: 'typesafe/jev-1.13', questionSha256,
  };
  const actualMetadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
  verifyCacheMetadata(fs.existsSync(rawOutput), actualMetadata, expectedMetadata);

  const saved = new Map();
  if (fs.existsSync(rawOutput)) {
    for (const line of fs.readFileSync(rawOutput, 'utf8').trim().split('\n')) {
      if (line) {
        const result = JSON.parse(line);
        saved.set(result.id, result); // A later retry replaces an earlier error.
      }
    }
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const [id, result] of saved) {
    const row = byId.get(id);
    if (!row || result.label !== row.label || result.source !== row.source) {
      throw Error('Saved result does not belong to the pinned corpus');
    }
  }
  const pending = rows.filter(row => !saved.has(row.id) || saved.get(row.id).status === 'error');
  console.log(JSON.stringify({ split, corpusSha256: sourceHash, selected: rows.length,
    pending: pending.length, concurrency: 20, spacingMs: 55 }));
  if (process.argv.includes('--dry-run')) return;

  // Check the request contract before making any paid calls. Replaying does not use the network.
  await replayResult(rows[0].message, { choice: 'review', status: 'review' });
  if (pending.length) {
    if (fs.existsSync('.env')) loadEnvFile('.env');
    if (!process.env.OPENROUTER_API_KEY) throw Error('OPENROUTER_API_KEY is missing');
  }
  if (!actualMetadata) {
    fs.writeFileSync(metadataPath, JSON.stringify(expectedMetadata) + '\n', { mode: 0o600 });
  }
  const { analyze } = require('../dist/backend/analyze.js');
  const maxCost = { test: 15, validation: 2, train: 5 }[split];
  let next = 0;
  let nextStart = performance.now();
  let completed = 0;
  let errors = 0;
  let attempts = 0;
  let cost = [...saved.values()].reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const started = performance.now();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function testOne(row) {
    let choice = 'error';
    let usage = null;
    let httpStatus = null;
    let modelMs = 0;
    const fetcher = async (url, options) => {
      verifyQuestion(options);
      let response;
      for (let retry = 0; retry < 4; retry++) {
        const start = performance.now();
        response = await fetch(url, options);
        modelMs += performance.now() - start;
        attempts++;
        httpStatus = response.status;
        if (![429, 503].includes(response.status) || retry === 3) break;
        await sleep((retry + 1) * 3000);
      }
      if (response.ok) {
        const data = await response.clone().json();
        const raw = data?.answers?.phishing_risk?.choice;
        if (choices.has(raw)) choice = raw;
        usage = data?.usage ?? null;
      }
      return response;
    };
    const start = performance.now();
    let status = 'error';
    try { status = (await analyze('jev', row.message, { fetcher })).status; }
    catch { /* No mail content or provider response is logged. */ }
    const result = {
      id: row.id, source: row.source, label: row.label, choice, status,
      modelMs: Math.round(modelMs), backendMs: Math.round(performance.now() - start),
      httpStatus, inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : null,
      cost: typeof usage?.cost === 'number' ? usage.cost : null,
    };
    fs.appendFileSync(rawOutput, JSON.stringify(result) + '\n', { mode: 0o600 });
    saved.set(row.id, result);
    completed++;
    if (status === 'error') errors++;
    cost += result.cost ?? 0;
    if (completed % 1000 === 0 || completed === pending.length) {
      console.log(JSON.stringify({ completed, total: pending.length, errors,
        costUsd: +cost.toFixed(6), attempts, elapsedS: +((performance.now() - started) / 1000).toFixed(1) }));
    }
  }

  async function worker() {
    while (next < pending.length && cost < maxCost) {
      const row = pending[next++];
      const startAt = nextStart;
      nextStart = Math.max(nextStart, performance.now()) + 55;
      await sleep(Math.max(0, startAt - performance.now()));
      await testOne(row);
    }
  }

  await Promise.all(Array.from({ length: 20 }, worker));
  const remaining = rows.filter(row => !saved.has(row.id) || saved.get(row.id).status === 'error');
  if (remaining.length) throw Error(`Benchmark incomplete: ${remaining.length} rows need a retry`);

  const finalRows = [];
  for (const row of rows) finalRows.push(await replayResult(row.message, saved.get(row.id)));
  const temporary = `${finalOutput}.tmp`;
  fs.writeFileSync(temporary, finalRows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(temporary, finalOutput);
  console.log(JSON.stringify({ done: true, completed, replayed: finalRows.length,
    output: finalOutput, costUsd: +cost.toFixed(6), attempts,
    elapsedS: +((performance.now() - started) / 1000).toFixed(1) }));
}

module.exports = { replayResult, verifyCorpus, verifyCacheMetadata };
if (require.main === module) main().catch(error => {
  // Parser/provider errors may contain mail fragments; print only our fixed diagnostic.
  console.error(error.message.startsWith('Unverified Jev result cache') ? error.message
    : 'Benchmark failed; check the pinned corpus, model question, key and output permissions.');
  process.exitCode = 1;
});
