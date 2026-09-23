import { isAnalyzeResult, isMailMessage, isMode } from '../shared/contracts';
import type { AnalysisFailure, AnalyzeResult, MailMessage } from '../shared/contracts';
import { consentKey, DEFAULT_SETTINGS, hasConsent, serverEndpoint } from '../shared/settings';

type MessageRequest = {
  type: 'analyze';
  requestId: string;
  mode: 'jev' | 'local';
  message: MailMessage;
};

function failure(requestId: string | undefined, code: string, message: string): AnalysisFailure {
  return { requestId, error: { code, message } };
}

function requestIdFrom(value: unknown): string | undefined {
  return value && typeof value === 'object' && 'requestId' in value && typeof value.requestId === 'string'
    ? value.requestId : undefined;
}

function isMessageRequest(value: unknown): value is MessageRequest {
  return value !== null && typeof value === 'object' &&
    'type' in value && value.type === 'analyze' &&
    'requestId' in value && typeof value.requestId === 'string' && value.requestId.length > 0 &&
    'mode' in value && isMode(value.mode) &&
    'message' in value && isMailMessage(value.message);
}

export function createMessageHandler({
  chromeApi, fetcher = fetch,
}: { chromeApi: typeof chrome; fetcher?: typeof fetch }) {
  return async (request: unknown, sender: { url?: string }): Promise<AnalyzeResult | AnalysisFailure> => {
    const requestId = requestIdFrom(request);
    if (!sender?.url?.startsWith('https://mail.google.com/') || !isMessageRequest(request)) {
      return failure(requestId, 'INVALID_REQUEST', 'Запит розширення некоректний.');
    }

    const saved = await chromeApi.storage.sync.get(['serverUrl', 'mode']);
    const serverUrl = typeof saved.serverUrl === 'string' ? saved.serverUrl : DEFAULT_SETTINGS.serverUrl;
    const mode = isMode(saved.mode) ? saved.mode : DEFAULT_SETTINGS.mode;
    const endpoint = serverEndpoint(serverUrl);
    if (!endpoint) return failure(requestId, 'INVALID_SERVER', 'Дозволено лише HTTP сервер на localhost або 127.0.0.1.');
    if (mode !== request.mode) return failure(requestId, 'INVALID_REQUEST', 'Режим змінився. Повторіть перевірку.');

    const key = consentKey({ serverUrl, mode });
    const consentState = await chromeApi.storage.local.get(['consents', 'consentGrantedAt', 'consentsRevokedAt']);
    if (!hasConsent(consentState, key)) return failure(requestId, 'CONSENT_REQUIRED', 'Потрібна згода на передачу листа.');

    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, mode, message: request.message }),
        signal: AbortSignal.timeout(25000),
        redirect: 'error',
      });
      if (!response.ok) return failure(requestId, 'UPSTREAM_ERROR', 'Сервер аналізу повернув помилку.');
      const data: unknown = await response.json();
      if (!isAnalyzeResult(data) || data.requestId !== requestId || data.mode !== mode) {
        return failure(requestId, 'INVALID_RESPONSE', 'Сервер повернув некоректну відповідь.');
      }
      return data;
    } catch {
      return failure(requestId, 'NETWORK_ERROR', 'Сервер недоступний або час очікування вичерпано.');
    }
  };
}

if (typeof chrome !== 'undefined') {
  const handleMessage = createMessageHandler({ chromeApi: chrome });
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    void handleMessage(request, sender).then(sendResponse);
    return true;
  });
}
