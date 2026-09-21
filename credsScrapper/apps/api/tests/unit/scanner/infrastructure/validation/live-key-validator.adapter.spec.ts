import * as crypto from 'node:crypto';
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

  it('explains missing AWS credentials without making a request', async () => {
    global.fetch = jest.fn();
    expect(await adapter.validateDetailed(ESecretType.AWS_ACCESS_KEY_ID, 'AKIA_SYNTHETIC')).toEqual({
      status: EFindingStatus.UNKNOWN, reason: 'Skipped: matching AWS Secret Access Key is missing.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('explains malformed GCP JSON without making a request', async () => {
    global.fetch = jest.fn();
    expect(await adapter.validateDetailed(ESecretType.GCP_SERVICE_ACCOUNT_KEY, 'not-json')).toEqual({
      status: EFindingStatus.UNKNOWN, reason: 'Skipped: GCP credentials are not valid JSON.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports timeout without including error text or credentials', async () => {
    global.fetch = jest.fn().mockRejectedValue(new DOMException('sensitive-fixture', 'TimeoutError'));
    expect(await adapter.validateDetailed(ESecretType.GITHUB_PAT, 'synthetic')).toEqual({
      status: EFindingStatus.UNKNOWN, reason: 'Inconclusive: provider request timed out.',
    });
  });

  it.each([
    [ESecretType.AWS_ACCESS_KEY_ID, 'ASIA_SYNTHETIC', 'Skipped: temporary AWS credentials require a session token; this validator does not support it.'],
    [ESecretType.GCP_SERVICE_ACCOUNT_KEY, '{}', 'Skipped: GCP credentials need private_key and client_email.'],
    [ESecretType.GCP_SERVICE_ACCOUNT_KEY, JSON.stringify({ private_key: 'not-pem', client_email: 'fixture@example.invalid' }), 'Skipped: GCP private key is not a readable PEM key.'],
    [ESecretType.PRIVATE_KEY_PEM, 'synthetic', 'Skipped: this credential type has no supported validator.'],
  ])('explains skipped validation for %s', async (type, value, reason) => {
    global.fetch = jest.fn();
    expect(await adapter.validateDetailed(type as ESecretType, value)).toEqual({ status: EFindingStatus.UNKNOWN, reason });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('distinguishes an unexpected provider response from a network error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    expect((await adapter.validateDetailed(ESecretType.GITHUB_PAT, 'synthetic')).reason).toBe('Inconclusive: provider response did not establish credential validity.');
    global.fetch = jest.fn().mockRejectedValue(new Error('sensitive-fixture'));
    expect((await adapter.validateDetailed(ESecretType.GITHUB_PAT, 'synthetic')).reason).toBe('Inconclusive: provider request failed or its response could not be read.');
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

  it('returns VALID for a GitHub fine-grained PAT that /user confirms with 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.GITHUB_FINE_GRAINED_PAT, 'github_pat_fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for an Asana token that /users/me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.ASANA_PERSONAL_ACCESS_TOKEN, 'fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a Bitbucket token that /user 401s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.BITBUCKET_ACCESS_TOKEN, 'fake');
    expect(status).toBe(EFindingStatus.INVALID);
  });

  it('returns VALID for a Supabase PAT that /v1/organizations confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.SUPABASE_PERSONAL_ACCESS_TOKEN, 'fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Render API key that /v1/owners confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.RENDER_API_KEY, 'fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Contentful PAT that /users/me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.CONTENTFUL_PERSONAL_ACCESS_TOKEN, 'fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns VALID for a Fly.io token via the read-only GraphQL viewer query', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.FLY_IO_API_TOKEN, 'fm2_fake');
    expect(status).toBe(EFindingStatus.VALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.fly.io/graphql',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns INVALID for a LaunchDarkly token that caller-identity 401s, using the raw token as the auth header', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.LAUNCHDARKLY_API_ACCESS_TOKEN, 'api-fake');
    expect(status).toBe(EFindingStatus.INVALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://app.launchdarkly.com/api/v2/caller-identity',
      expect.objectContaining({ headers: { Authorization: 'api-fake' } }),
    );
  });

  it('returns VALID for a Doppler token that /v3/me confirms', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.DOPPLER_TOKEN, 'dp.pt.fake');
    expect(status).toBe(EFindingStatus.VALID);
  });

  it('returns INVALID for a ClickUp token that /user 401s, using the raw token as the auth header', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as never;

    const status = await adapter.validate(ESecretType.CLICKUP_PERSONAL_API_TOKEN, 'pk_fake');
    expect(status).toBe(EFindingStatus.INVALID);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/user',
      expect.objectContaining({ headers: { Authorization: 'pk_fake' } }),
    );
  });

  it('returns UNKNOWN for an AWS access key ID with no paired secret key, without making a request', async () => {
    global.fetch = jest.fn() as never;

    const status = await adapter.validate(ESecretType.AWS_ACCESS_KEY_ID, 'AKIAABCDEFGH12345678');

    expect(status).toBe(EFindingStatus.UNKNOWN);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns VALID for an AWS credential pair that sts:GetCallerIdentity confirms with 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(
      ESecretType.AWS_ACCESS_KEY_ID,
      'AKIAABCDEFGH12345678',
      'a'.repeat(40),
    );

    expect(status).toBe(EFindingStatus.VALID);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15');
    expect(options.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAABCDEFGH12345678\//);
    expect(options.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('returns INVALID for an AWS credential pair that sts:GetCallerIdentity 403s', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as never;

    const status = await adapter.validate(
      ESecretType.AWS_ACCESS_KEY_ID,
      'AKIAABCDEFGH12345678',
      'a'.repeat(40),
    );

    expect(status).toBe(EFindingStatus.INVALID);
  });

  function makeGcpKey(overrides: Record<string, unknown> = {}) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    return JSON.stringify({
      type: 'service_account',
      project_id: 'fake-project',
      private_key: privateKey,
      client_email: 'svc@fake-project.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
      ...overrides,
    });
  }

  it('returns VALID for a GCP service account key that the token endpoint accepts with 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    const status = await adapter.validate(ESecretType.GCP_SERVICE_ACCOUNT_KEY, makeGcpKey());

    expect(status).toBe(EFindingStatus.VALID);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options.method).toBe('POST');
    expect(String(options.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
  });

  it('returns INVALID for a GCP service account key the token endpoint rejects with invalid_grant (400)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as never;

    const status = await adapter.validate(ESecretType.GCP_SERVICE_ACCOUNT_KEY, makeGcpKey());

    expect(status).toBe(EFindingStatus.INVALID);
  });

  it('returns UNKNOWN for a GCP key value that is not valid JSON, without making a request', async () => {
    global.fetch = jest.fn() as never;

    const status = await adapter.validate(ESecretType.GCP_SERVICE_ACCOUNT_KEY, 'not json');

    expect(status).toBe(EFindingStatus.UNKNOWN);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores an attacker-controlled token_uri and always posts to the real Google endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as never;

    await adapter.validate(
      ESecretType.GCP_SERVICE_ACCOUNT_KEY,
      makeGcpKey({ token_uri: 'https://internal.attacker.example/steal' }),
    );

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
  });

  it('returns UNKNOWN for a GCP key JSON missing private_key/client_email, without making a request', async () => {
    global.fetch = jest.fn() as never;

    const status = await adapter.validate(
      ESecretType.GCP_SERVICE_ACCOUNT_KEY,
      JSON.stringify({ type: 'service_account' }),
    );

    expect(status).toBe(EFindingStatus.UNKNOWN);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
