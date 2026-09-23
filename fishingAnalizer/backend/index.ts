import { createServer } from 'node:http';
import { createHandler } from './http';

createServer(createHandler()).listen(8787, '127.0.0.1', () => {
  process.stdout.write('fishingAnalizer server listening on 127.0.0.1:8787\n');
});
