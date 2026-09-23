import type { IncomingMessage, ServerResponse } from 'node:http';
import { isMailMessage, isMode, type MailMessage } from '../shared/contracts';
import { analyze } from './analyze';
import { homePage } from './home-page';

export type HandlerOptions = { fetcher?: typeof fetch; env?: NodeJS.ProcessEnv };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function visibleMessage(message: MailMessage): MailMessage {
  return {
    sender: { name: message.sender.name, email: message.sender.email },
    subject: message.subject,
    text: message.text,
    links: message.links.map(({ text, url }) => ({ text, url })),
    attachments: [...message.attachments],
    truncated: message.truncated,
  };
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

export function createHandler(options: HandlerOptions = {}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      send(res, 403, { error: { code: 'FORBIDDEN', message: 'Джерело запиту не дозволене.' } });
      return;
    }
    if (origin) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    if (req.method === 'OPTIONS' && req.url === '/analyze') {
      res.writeHead(204, {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(homePage);
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true, service: 'fishingAnalizer' });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/analyze') {
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'Маршрут не знайдено.' } });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      send(res, 415, { error: { code: 'INVALID_REQUEST', message: 'Очікується JSON.' } });
      return;
    }
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 65536) {
          send(res, 413, { error: { code: 'INVALID_REQUEST', message: 'Лист завеликий для аналізу.' } });
          return;
        }
      }
      const input: unknown = JSON.parse(raw);
      const requestId = isRecord(input) && validRequestId(input.requestId) ? input.requestId : undefined;
      if (!isRecord(input) || !requestId || !isMode(input.mode) || !isMailMessage(input.message)) {
        send(res, 400, { requestId, error: { code: 'INVALID_REQUEST', message: 'Некоректні дані листа.' } });
        return;
      }
      try {
        const result = await analyze(input.mode, visibleMessage(input.message), options);
        send(res, 200, { requestId, mode: input.mode, ...result });
      } catch (error) {
        const config = (error as { code?: string }).code === 'CONFIG_ERROR';
        send(res, config ? 503 : 502, {
          requestId,
          error: {
            code: config ? 'CONFIG_ERROR' : 'UPSTREAM_ERROR',
            message: config
              ? 'Сервер аналізу не налаштовано.'
              : 'Модель зараз недоступна або повернула некоректну відповідь.',
          },
        });
      }
    } catch {
      if (!res.writableEnded) send(res, 400, { error: { code: 'INVALID_REQUEST', message: 'Некоректний JSON.' } });
    }
  };
}
