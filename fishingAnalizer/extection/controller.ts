import { isAnalyzeResult, isMode } from '../shared/contracts';
import type { AnalyzeResult, MailMessage, Mode } from '../shared/contracts';
import { consentKey, DEFAULT_SETTINGS, grantConsent, hasConsent } from '../shared/settings';
import type { Settings } from '../shared/settings';
import { collectMessages, readMessage } from './dom';
import { createPanel, renderPanel } from './panel';

type CacheEntry =
  | { kind: 'pending' }
  | { kind: 'success'; result: AnalyzeResult }
  | { kind: 'error'; message: string };

type ControllerOptions = {
  document: Document;
  chromeApi: typeof chrome;
  route?: () => string;
};

async function digest(message: MailMessage): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function responseError(response: unknown): string {
  if (response && typeof response === 'object' && 'error' in response) {
    const error = response.error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return 'Сервер недоступний або відповідь некоректна.';
}

export function createController({ document, chromeApi, route = () => document.location.href }: ControllerOptions) {
  const cache = new Map<string, CacheEntry>();
  let scanGeneration = 0;
  let currentSettingsKey = '';

  async function readContext(): Promise<{ settings: Settings; consented: boolean }> {
    const [saved, local] = await Promise.all([
      chromeApi.storage.sync.get(['serverUrl', 'mode']),
      chromeApi.storage.local.get(['consents', 'consentGrantedAt', 'consentsRevokedAt']),
    ]);
    const settings: Settings = {
      serverUrl: typeof saved.serverUrl === 'string' ? saved.serverUrl : DEFAULT_SETTINGS.serverUrl,
      mode: isMode(saved.mode) ? saved.mode : DEFAULT_SETTINGS.mode,
    };
    return {
      settings,
      consented: hasConsent(local, consentKey(settings)),
    };
  }

  function panelFor(node: Element): HTMLElement {
    const existing = [...node.children].find(child => child.classList.contains('fishing-analizer'));
    if (existing) return existing as HTMLElement;
    const panel = createPanel(document);
    node.append(panel);
    return panel;
  }

  function showCached(panel: HTMLElement, key: string, entry: CacheEntry): void {
    if (panel.dataset.state === entry.kind) return;
    if (entry.kind === 'success') renderPanel(panel, { kind: 'success', result: entry.result });
    if (entry.kind === 'error') renderPanel(panel, {
      kind: 'error', message: entry.message,
      onRetry: () => { cache.delete(key); void scan(); },
    });
    if (entry.kind === 'pending') renderPanel(panel, { kind: 'pending' });
  }

  function isCurrent(node: Element, panel: HTMLElement, key: string, settingsKey: string, originalRoute: string): boolean {
    return node.isConnected && route() === originalRoute &&
      panel.dataset.key === key && currentSettingsKey === settingsKey &&
      collectMessages(document).includes(node);
  }

  async function receiveResponse(
    response: unknown, requestId: string, node: Element, panel: HTMLElement,
    key: string, settings: Settings, originalRoute: string, message: MailMessage,
  ): Promise<void> {
    const entry: CacheEntry = isAnalyzeResult(response) && response.requestId === requestId
      ? { kind: 'success', result: response }
      : { kind: 'error', message: responseError(response) };
    cache.set(key, entry);

    const settingsKey = consentKey(settings);
    if (!isCurrent(node, panel, key, settingsKey, originalRoute)) return;
    const latest = await readContext();
    if (consentKey(latest.settings) !== settingsKey || !latest.consented) return;
    if (JSON.stringify(readMessage(node, document)) !== JSON.stringify(message)) return;
    if (!isCurrent(node, panel, key, settingsKey, originalRoute)) return;
    showCached(panel, key, entry);
  }

  function requestAnalysis(
    node: Element, panel: HTMLElement, key: string, settings: Settings,
    message: MailMessage, originalRoute: string,
  ): void {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cache.set(key, { kind: 'pending' });
    showCached(panel, key, { kind: 'pending' });
    chromeApi.runtime.sendMessage(
      { type: 'analyze', requestId, mode: settings.mode, message },
      response => {
        void receiveResponse(response, requestId, node, panel, key, settings, originalRoute, message);
      },
    );
  }

  async function scan(): Promise<void> {
    const generation = ++scanGeneration;
    const { settings, consented } = await readContext();
    if (generation !== scanGeneration) return;

    const settingsKey = consentKey(settings);
    if (currentSettingsKey !== settingsKey) {
      currentSettingsKey = settingsKey;
      for (const panel of document.querySelectorAll('.fishing-analizer')) panel.remove();
    }

    const nodes = collectMessages(document);
    for (const panel of document.querySelectorAll('.fishing-analizer')) {
      if (!panel.parentElement || !nodes.includes(panel.parentElement)) panel.remove();
    }

    const originalRoute = route();
    for (const node of nodes) {
      const panel = panelFor(node);
      const message = readMessage(node, document);
      const messageHash = await digest(message);
      if (generation !== scanGeneration) return;
      const messageId = node.getAttribute('data-legacy-message-id') ||
        node.getAttribute('data-message-id') || messageHash;
      const key = `${settingsKey}|${messageId}|${messageHash}`;

      if (panel.dataset.key !== key) {
        panel.dataset.key = key;
        panel.replaceChildren();
        delete panel.dataset.state;
      }

      if (!consented) {
        if (panel.dataset.state !== 'consent') renderPanel(panel, {
          kind: 'consent',
          mode: settings.mode,
          onConsent: () => {
            const clickedAt = Date.now();
            void chromeApi.storage.local.get(['consents', 'consentGrantedAt']).then(storage =>
              chromeApi.storage.local.set(grantConsent(storage, settingsKey, clickedAt)),
            ).then(scan);
          },
        });
        continue;
      }

      const cached = cache.get(key);
      if (cached) {
        showCached(panel, key, cached);
        continue;
      }

      requestAnalysis(node, panel, key, settings, message, originalRoute);
    }
  }

  return { scan };
}
