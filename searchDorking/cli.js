#!/usr/bin/env node
import { search } from './search.js';

const values = process.argv.slice(2);
if (values.length === 0) {
  console.error('Usage: node cli.js <value> [value...]');
  process.exit(1);
}

const results = await search(values);
for (const r of results) {
  console.log(`\n[${r.query}]`);
  if (r.url) console.log(r.url);
  else if (r.error) console.log(`error: ${r.error}`);
  else for (const item of r.items) console.log(`- ${item.title}\n  ${item.link}`);
}
