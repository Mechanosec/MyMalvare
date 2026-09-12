import { Injectable } from '@nestjs/common';
import { KeyValidatorPort } from '../../application/ports/key-validator.port';
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';

const TIMEOUT_MS = 5000;

type TChecker = (secretValue: string) => Promise<EFindingStatus>;

async function checkBearer(url: string, value: string, extraHeaders: Record<string, string> = {}): Promise<EFindingStatus> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${value}`, ...extraHeaders },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) return EFindingStatus.INVALID;
  if (res.ok) return EFindingStatus.VALID;
  return EFindingStatus.UNKNOWN;
}

// GitHub's /user works identically for PATs and OAuth tokens - both use
// the same `token <value>` auth scheme.
const checkGithubToken: TChecker = async (value) => {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${value}`, 'User-Agent': 'credsScrapper' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) return EFindingStatus.INVALID;
  if (res.ok) return EFindingStatus.VALID;
  return EFindingStatus.UNKNOWN;
};

// Stripe accepts the secret key as Bearer auth (in place of HTTP Basic) -
// https://stripe.com/docs/api/authentication. /v1/balance is a plain
// read, same account regardless of live/test/restricted key.
const checkStripeSecretKey: TChecker = (value) => checkBearer('https://api.stripe.com/v1/balance', value);

// DigitalOcean's /v2/account works the same for a PAT and an OAuth token.
const checkDigitalOceanToken: TChecker = (value) => checkBearer('https://api.digitalocean.com/v2/account', value);

// One read-only, side-effect-free request per service - a plain identity/
// "who am I" check, never an action the credential's real owner would
// notice or that touches their data. Services with no entry here always
// resolve to UNKNOWN (see the port's contract) - usually because the
// secret type needs a paired value we don't have (e.g. AWS access key ID
// needs its secret key too), needs a per-account host we don't know
// (Shopify shop domain, self-hosted Grafana/Vault/Databricks), or isn't a
// bearer credential at all (private keys, OAuth client secrets, webhook
// signing secrets).
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

  [ESecretType.GITHUB_PAT]: checkGithubToken,
  [ESecretType.GITHUB_OAUTH_TOKEN]: checkGithubToken,

  [ESecretType.GITLAB_PAT]: async (value) => {
    const res = await fetch('https://gitlab.com/api/v4/user', {
      headers: { 'PRIVATE-TOKEN': value },
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

  [ESecretType.OPENAI_API_KEY]: (value) => checkBearer('https://api.openai.com/v1/models', value),

  [ESecretType.ANTHROPIC_API_KEY]: async (value) => {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.STRIPE_LIVE_SECRET_KEY]: checkStripeSecretKey,
  [ESecretType.STRIPE_TEST_SECRET_KEY]: checkStripeSecretKey,
  [ESecretType.STRIPE_RESTRICTED_KEY]: checkStripeSecretKey,

  // auth.test always responds 200 with a JSON `ok` flag rather than an
  // HTTP error status, even for a dead token.
  [ESecretType.SLACK_TOKEN]: async (value) => {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return EFindingStatus.UNKNOWN;
    const body: unknown = await res.json();
    const ok = typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
    return ok ? EFindingStatus.VALID : EFindingStatus.INVALID;
  },

  [ESecretType.DISCORD_BOT_TOKEN]: async (value) => {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  // A GET on a Discord webhook URL returns the webhook object without
  // posting anything - the only read-only way to check one. `value` here
  // is the whole URL (not just a token), which a hostile "finding" could
  // point anywhere - fetching it unchecked would be SSRF. Only ever fetch
  // it once it's confirmed to actually be a Discord webhook URL, and
  // disable redirects so a 3xx can't bounce the request somewhere else.
  [ESecretType.DISCORD_WEBHOOK_URL]: async (value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return EFindingStatus.UNKNOWN;
    }
    const isDiscordWebhook =
      url.protocol === 'https:' &&
      (url.hostname === 'discord.com' || url.hostname === 'discordapp.com') &&
      url.pathname.startsWith('/api/webhooks/');
    if (!isDiscordWebhook) {
      return EFindingStatus.UNKNOWN;
    }
    const res = await fetch(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 || res.status === 404) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.SENDGRID_API_KEY]: (value) => checkBearer('https://api.sendgrid.com/v3/scopes', value),

  // Mailgun authenticates with HTTP Basic, username "api" and the key as
  // the password - there's no Bearer scheme.
  [ESecretType.MAILGUN_API_KEY]: async (value) => {
    const res = await fetch('https://api.mailgun.net/v3/domains', {
      headers: { Authorization: `Basic ${Buffer.from(`api:${value}`).toString('base64')}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  // Mailchimp keys embed their datacenter as a suffix (e.g. "...-us21") -
  // the API host is per-datacenter, so it's parsed out of the key itself.
  [ESecretType.MAILCHIMP_API_KEY]: async (value) => {
    const dc = value.split('-').pop();
    if (!dc || dc === value) return EFindingStatus.UNKNOWN;
    const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
      headers: { Authorization: `Basic ${Buffer.from(`anystring:${value}`).toString('base64')}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.SQUARE_ACCESS_TOKEN]: async (value) => {
    const res = await fetch('https://connect.squareup.com/v2/locations', {
      headers: { Authorization: `Bearer ${value}`, 'Square-Version': '2024-01-18' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.DIGITALOCEAN_PAT]: checkDigitalOceanToken,
  [ESecretType.DIGITALOCEAN_OAUTH_TOKEN]: checkDigitalOceanToken,

  [ESecretType.AIRTABLE_API_KEY]: (value) => checkBearer('https://api.airtable.com/v0/meta/whoami', value),

  [ESecretType.NOTION_API_TOKEN]: (value) =>
    checkBearer('https://api.notion.com/v1/users/me', value, { 'Notion-Version': '2022-06-28' }),

  [ESecretType.TERRAFORM_CLOUD_TOKEN]: (value) => checkBearer('https://app.terraform.io/api/v2/account/details', value),

  // Linear has no REST "whoami" - a minimal read-only GraphQL query
  // (never a mutation) plays the same role. Auth header is the raw key,
  // no "Bearer" prefix - https://developers.linear.app/docs/graphql/working-with-the-graphql-api#authentication.
  [ESecretType.LINEAR_API_KEY]: async (value) => {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.SENTRY_AUTH_TOKEN]: (value) => checkBearer('https://sentry.io/api/0/organizations/', value),

  [ESecretType.FIGMA_PERSONAL_ACCESS_TOKEN]: async (value) => {
    const res = await fetch('https://api.figma.com/v1/me', {
      headers: { 'X-Figma-Token': value },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 403) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.NEW_RELIC_API_KEY]: async (value) => {
    const res = await fetch('https://api.newrelic.com/v2/applications.json', {
      headers: { 'X-Api-Key': value },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.POSTMAN_API_KEY]: async (value) => {
    const res = await fetch('https://api.getpostman.com/me', {
      headers: { 'X-Api-Key': value },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  // Dropbox's endpoints are RPC-style POSTs even for reads - this one
  // only ever reads the token owner's basic account info.
  [ESecretType.DROPBOX_SHORT_LIVED_TOKEN]: async (value) => {
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.FACEBOOK_ACCESS_TOKEN]: (value) => checkBearer('https://graph.facebook.com/me', value),

  // App-only bearer token: fetches one public, fixed tweet rather than
  // anything tied to a specific user's account.
  [ESecretType.TWITTER_BEARER_TOKEN]: (value) => checkBearer('https://api.twitter.com/2/tweets?ids=20', value),
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
