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

  it('returns VALID for a Stripe secret key that /v1/balance confirms with 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.STRIPE_LIVE_SECRET_KEY, 'sk_live_fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Stripe test/restricted key that 401s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    expect(await adapter.validate(ESecretType.STRIPE_TEST_SECRET_KEY, 'sk_test_fake')).toBe(
      EFindingStatus.INVALID,
    );
    expect(await adapter.validate(ESecretType.STRIPE_RESTRICTED_KEY, 'rk_live_fake')).toBe(
      EFindingStatus.INVALID,
    );
  });

  it('returns VALID for a Slack token that auth.test confirms ok:true', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }) as never;

    const status = await adapter.validate(ESecretType.SLACK_TOKEN, 'xoxb-fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Slack token that auth.test confirms ok:false', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, error: 'invalid_auth' }) }) as never;

    const status = await adapter.validate(ESecretType.SLACK_TOKEN, 'xoxb-fake');
    expect(status).toBe(EFindingStatus.INVALID);
  });

  it('returns VALID for a GitHub OAuth token that /user confirms (same check as a PAT)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.GITHUB_OAUTH_TOKEN, 'gho_fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a GitLab PAT that /user 401s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.GITLAB_PAT, 'glpat-fake');
    expect(status).toBe(EFindingStatus.INVALID);
  });

  it('returns VALID for a Discord bot token that /users/@me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.DISCORD_BOT_TOKEN, 'fake-bot-token');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Discord webhook URL that 404s (deleted/invalid)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;

    const status = await adapter.validate(
      ESecretType.DISCORD_WEBHOOK_URL,
      'https://discord.com/api/webhooks/1/fake',
    );
    expect(status).toBe(EFindingStatus.INVALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/1/fake',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('refuses to fetch a value that is not actually a discord.com webhook URL (SSRF guard)', async () => {
    global.fetch = jest.fn() as never;

    for (const value of [
      'https://attacker.example/api/webhooks/1/fake', // wrong host
      'http://discord.com/api/webhooks/1/fake', // not https
      'https://discord.com/some-other-path', // not a webhook path
      'https://discord.com.attacker.example/api/webhooks/1/fake', // hostname-suffix trick
      'not a url at all',
    ]) {
      const status = await adapter.validate(ESecretType.DISCORD_WEBHOOK_URL, value);
      expect(status).toBe(EFindingStatus.UNKNOWN);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts a legacy discordapp.com webhook host', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(
      ESecretType.DISCORD_WEBHOOK_URL,
      'https://discordapp.com/api/webhooks/1/fake',
    );
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a SendGrid key that /v3/scopes confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.SENDGRID_API_KEY, 'SG.fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Mailgun key that 401s, sent as Basic auth', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.MAILGUN_API_KEY, 'key-fake');
    expect(status).toBe(EFindingStatus.INVALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mailgun.net/v3/domains',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }) }),
    );
  });

  it('returns VALID for a Mailchimp key, hitting the datacenter parsed from its suffix', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.MAILCHIMP_API_KEY, 'fakekey-us21');
    expect(status).toBe(EFindingStatus.VALID);
    expect(global.fetch).toHaveBeenCalledWith('https://us21.api.mailchimp.com/3.0/ping', expect.anything());
  });

  it('returns UNKNOWN for a Mailchimp key with no datacenter suffix, rather than guessing a host', async () => {
    global.fetch = jest.fn() as never;

    const status = await adapter.validate(ESecretType.MAILCHIMP_API_KEY, 'nodashsuffix');
    expect(status).toBe(EFindingStatus.UNKNOWN);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns VALID for a Square access token that /v2/locations confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.SQUARE_ACCESS_TOKEN, 'fake-square-token');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for both a DigitalOcean PAT and OAuth token via the same /v2/account check', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    expect(await adapter.validate(ESecretType.DIGITALOCEAN_PAT, 'dop_v1_fake')).toBe(EFindingStatus.VALID);
    expect(await adapter.validate(ESecretType.DIGITALOCEAN_OAUTH_TOKEN, 'fake-oauth')).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for an Airtable key that /v0/meta/whoami confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.AIRTABLE_API_KEY, 'pat.fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Notion token that /v1/users/me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.NOTION_API_TOKEN, 'secret_fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Terraform Cloud token that /account/details confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.TERRAFORM_CLOUD_TOKEN, 'fake-tfc-token');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Linear key that the viewer GraphQL query 401s, sent without a Bearer prefix', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.LINEAR_API_KEY, 'lin_api_fake');
    expect(status).toBe(EFindingStatus.INVALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'lin_api_fake' }),
      }),
    );
  });

  it('returns VALID for a Sentry token that /organizations/ confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.SENTRY_AUTH_TOKEN, 'sntrys_fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Figma token that /v1/me 403s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as never;

    const status = await adapter.validate(ESecretType.FIGMA_PERSONAL_ACCESS_TOKEN, 'figd_fake');
    expect(status).toBe(EFindingStatus.INVALID);
  });

  it('returns VALID for a New Relic key that /v2/applications.json confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.NEW_RELIC_API_KEY, 'NRAK-fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Postman key that /me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.POSTMAN_API_KEY, 'PMAK-fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Dropbox token via the read-only get_current_account RPC POST', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.DROPBOX_SHORT_LIVED_TOKEN, 'sl.fake');
    expect(status).toBe(EFindingStatus.VALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.dropboxapi.com/2/users/get_current_account',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns VALID for a Facebook access token that graph.facebook.com/me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.FACEBOOK_ACCESS_TOKEN, 'fake-fb-token');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Twitter bearer token that a public-tweet fetch 401s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.TWITTER_BEARER_TOKEN, 'fake-bearer');
    expect(status).toBe(EFindingStatus.INVALID);
  });
});
