import { createInterface } from 'node:readline';
import { analyze } from '../backend/analyze';
import { isStatus } from '../shared/contracts';
import type { MailMessage, Status } from '../shared/contracts';

// One local model request per email. Capture its choice while the real backend
// analysis code applies the observable rules. Input and output use memory only.
for await (const line of createInterface({ input: process.stdin })) {
  let choice: Status | 'error' = 'error';
  let layaMs = 0;
  const started = performance.now();
  try {
    const message = JSON.parse(line) as MailMessage;
    const fetcher: typeof fetch = async (url, options) => {
      const modelStarted = performance.now();
      let response: Response;
      try { response = await fetch(url, options); }
      finally { layaMs = performance.now() - modelStarted; }
      if (response.ok) {
        const data = await response.clone().json() as { answers?: { phishing_risk?: { choice?: unknown } } };
        const answer = data.answers?.phishing_risk?.choice;
        choice = isStatus(answer) ? answer : 'error';
      }
      return response;
    };
    const result = await analyze('local', message, { fetcher });
    process.stdout.write(JSON.stringify({ laya: choice, backend: result.status,
      layaMs, backendMs: performance.now() - started }) + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ laya: choice, backend: 'error',
      layaMs, backendMs: performance.now() - started }) + '\n');
  }
}
