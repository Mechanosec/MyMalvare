import { Injectable } from '@nestjs/common';
import { KeyValidatorPort } from '../../application/ports/key-validator.port';
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';

const TIMEOUT_MS = 5000;

type TChecker = (secretValue: string) => Promise<EFindingStatus>;

// One read-only, side-effect-free request per service - a plain identity/
// "who am I" check, never an action the credential's real owner would
// notice or that touches their data. Services with no entry here always
// resolve to UNKNOWN (see the port's contract).
const CHECKERS: Partial<Record<ESecretType, TChecker>> = {
  [ESecretType.TELEGRAM_BOT_TOKEN]: async (value) => {
    const res = await fetch(`https://api.telegram.org/bot${value}/getMe`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (!res.ok) return EFindingStatus.UNKNOWN;
    const body: unknown = await res.json();
    const ok = typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
    return ok ? EFindingStatus.VALID : EFindingStatus.UNKNOWN;
  },

  [ESecretType.GITHUB_PAT]: async (value) => {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${value}`, 'User-Agent': 'credsScrapper' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.NPM_ACCESS_TOKEN]: async (value) => {
    const res = await fetch('https://registry.npmjs.org/-/whoami', {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.OPENAI_API_KEY]: async (value) => {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.ANTHROPIC_API_KEY]: async (value) => {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },
};

@Injectable()
export class LiveKeyValidatorAdapter extends KeyValidatorPort {
  async validate(secretType: ESecretType, secretValue: string): Promise<EFindingStatus> {
    const check = CHECKERS[secretType];
    if (!check) return EFindingStatus.UNKNOWN;
    try {
      return await check(secretValue);
    } catch {
      return EFindingStatus.UNKNOWN; // network error/timeout - never guess INVALID
    }
  }
}
