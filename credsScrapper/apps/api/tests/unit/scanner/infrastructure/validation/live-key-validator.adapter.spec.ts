import { LiveKeyValidatorAdapter } from '../../../../../src/modules/scanner/infrastructure/validation/live-key-validator.adapter';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

describe('LiveKeyValidatorAdapter', () => {
  const adapter = new LiveKeyValidatorAdapter();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns UNKNOWN for a secret type with no registered checker', async () => {
    const status = await adapter.validate(ESecretType.AWS_ACCESS_KEY_ID, 'AKIAABCDEFGH12345678');
    expect(status).toBe(EFindingStatus.UNKNOWN);
  });

  it('returns VALID for a Telegram token that getMe confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as never;

    const status = await adapter.validate(ESecretType.TELEGRAM_BOT_TOKEN, 'fake-token');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Telegram token that 401s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.TELEGRAM_BOT_TOKEN, 'fake-token');
    expect(status).toBe(EFindingStatus.INVALID);
  });

  it('returns UNKNOWN (never INVALID) when the request throws, e.g. a timeout', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as never;

    const status = await adapter.validate(ESecretType.GITHUB_PAT, 'fake-token');
    expect(status).toBe(EFindingStatus.UNKNOWN);
  });

  it('returns VALID for a GitHub PAT that /user confirms with 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.GITHUB_PAT, 'fake-token');
    expect(status).toBe(EFindingStatus.VALID);
  });
});
