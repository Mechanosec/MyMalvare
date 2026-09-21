import assert from 'node:assert';
import { buildQueries, buildSearchUrl } from './dorks.js';

const queries = buildQueries(['secret123'], ['"{q}"', 'filetype:env "{q}"']);
assert.deepStrictEqual(queries, ['"secret123"', 'filetype:env "secret123"']);

const url = buildSearchUrl('filetype:env "secret123"');
assert.ok(url.startsWith('https://www.google.com/search?q='));
assert.ok(url.includes(encodeURIComponent('secret123')));

console.log('ok');
