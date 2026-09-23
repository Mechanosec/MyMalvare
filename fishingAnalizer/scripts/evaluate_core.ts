import { createInterface } from 'node:readline';
import { analyze } from '../backend/analyze';
import { isStatus } from '../shared/contracts';
import type { MailMessage, Status } from '../shared/contracts';

// One local model request per email. Capture its choice while the real backend
// analysis code applies the observable rules. Input and output use memory only.
for await (const line of createInterface({ input: process.stdin })) {
  let choice: Status | 'error' = 'error';
  try {
    const message = JSON.parse(line) as MailMessage;
    const fetcher: typeof fetch = async (url, options) => {
      const response = await fetch(url, options);
      if (response.ok) {
        const data = await response.clone().json() as { answers?: { phishing_risk?: { choice?: unknown } } };
        const answer = data.answers?.phishing_risk?.choice;
        choice = isStatus(answer) ? answer : 'error';
      }
      return response;
    };
    const result = await analyze('local', message, { fetcher });
    process.stdout.write(JSON.stringify({ laya: choice, backend: result.status }) + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ laya: choice, backend: 'error' }) + '\n');
  }
}
