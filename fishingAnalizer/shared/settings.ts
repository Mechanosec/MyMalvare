import type { Mode } from './contracts';

export type Settings = { serverUrl: string; mode: Mode };
export const DEFAULT_SETTINGS: Settings = { serverUrl: 'http://127.0.0.1:8787', mode: 'local' };

export function serverEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
    return `${url.origin}/analyze`;
  } catch {
    return null;
  }
}

export function consentKey(settings: Settings): string {
  return `${settings.serverUrl}|${settings.mode}`;
}

export function readConsents(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] =>
    typeof entry[1] === 'boolean'));
}

function grantTimes(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1])));
}

export function hasConsent(storage: Record<string, unknown>, key: string): boolean {
  if (!readConsents(storage.consents)[key]) return false;
  const revokedAt = typeof storage.consentsRevokedAt === 'number' ? storage.consentsRevokedAt : 0;
  return revokedAt === 0 || (grantTimes(storage.consentGrantedAt)[key] ?? 0) > revokedAt;
}

export function grantConsent(storage: Record<string, unknown>, key: string, clickedAt: number) {
  return {
    consents: { ...readConsents(storage.consents), [key]: true },
    consentGrantedAt: { ...grantTimes(storage.consentGrantedAt), [key]: clickedAt },
  };
}
