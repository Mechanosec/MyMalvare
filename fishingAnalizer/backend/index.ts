import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHandler } from './http';

if (existsSync('.env')) loadEnvFile('.env');

createServer(createHandler()).listen(8787, '127.0.0.1', () => {
  process.stdout.write('fishingAnalizer server listening on 127.0.0.1:8787\n');
});
