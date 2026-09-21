import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import {
  KeyValidatorPort,
  IValidationResult,
} from '../../application/ports/key-validator.port';
import { EFindingStatus } from '../../domain/constant/finding-status.constant';
import { ESecretType } from '../../domain/constant/secret-type.constant';
import { parseAwsCredentials } from '../../domain/detection/aws-credentials';

const TIMEOUT_MS = 5000;

type TChecker = (
  secretValue: string,
  pairedValue?: string,
) => Promise<EFindingStatus>;

async function checkBearer(
  url: string,
  value: string,
  extraHeaders: Record<string, string> = {},
): Promise<EFindingStatus> {
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
const checkStripeSecretKey: TChecker = (value) =>
  checkBearer('https://api.stripe.com/v1/balance', value);

// DigitalOcean's /v2/account works the same for a PAT and an OAuth token.
const checkDigitalOceanToken: TChecker = (value) =>
  checkBearer('https://api.digitalocean.com/v2/account', value);

// AWS has no bearer-token auth - every request is SigV4-signed with both
// halves of the credential pair. sts:GetCallerIdentity is AWS's own
// documented way to validate a credential: a plain GET with no request
// body, needs no IAM permissions beyond "this key can authenticate at
// all" (every principal can call it), and touches nothing in the
// account - purely a read of "who does this signature belong to".
// https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html
async function checkAwsCredentials(
  accessKeyId: string,
  secretAccessKey: string,
): Promise<EFindingStatus> {
  const region = 'us-east-1';
  const service = 'sts';
  const host = 'sts.amazonaws.com';
  const method = 'GET';
  const canonicalUri = '/';
  const canonicalQuerystring = 'Action=GetCallerIdentity&Version=2011-06-15';

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const hash = (data: string) =>
    crypto.createHash('sha256').update(data).digest('hex');
  const hmac = (key: Buffer | string, data: string) =>
    crypto.createHmac('sha256', key).update(data).digest();

  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    hash(''),
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(
    `https://${host}${canonicalUri}?${canonicalQuerystring}`,
    {
      method,
      headers: { 'x-amz-date': amzDate, Authorization: authorizationHeader },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  // AWS returns 403 for both "bad access key id" (InvalidClientTokenId)
  // and "bad secret key" (SignatureDoesNotMatch) - either way the pair
  // is dead. A malformed request from our own signing bug would show up
  // as some other 4xx, which correctly falls through to UNKNOWN instead
  // of a false INVALID.
  if (res.status === 403) return EFindingStatus.INVALID;
  if (res.ok) return EFindingStatus.VALID;
  return EFindingStatus.UNKNOWN;
}

// A GCP service account key is a full JSON credentials file (see
// extractGcpServiceAccountJson in domain/detection/engine.ts) - live-
// testing it means proving the private_key inside actually signs for the
// client_email Google has on file. Exchanging a self-signed JWT assertion
// for an OAuth access token (RFC 7523) does exactly that and nothing
// else: no Cloud API is ever called, so this never touches any resource
// the service account can access, and a dead/deleted/disabled key
// reliably comes back as invalid_grant.
// The token_uri field of the JSON is attacker-controlled (it comes from
// scanned repo content) and is never used as a fetch target - the real
// Google OAuth endpoint is the only value that ever makes sense here, so
// it's hardcoded rather than trusted from the parsed key.
const GCP_TOKEN_URI = 'https://oauth2.googleapis.com/token';

async function checkGcpServiceAccountKey(
  secretValue: string,
): Promise<EFindingStatus> {
  let key: { private_key?: unknown; client_email?: unknown };
  try {
    key = JSON.parse(secretValue);
  } catch {
    return EFindingStatus.UNKNOWN;
  }
  if (
    typeof key.private_key !== 'string' ||
    typeof key.client_email !== 'string'
  ) {
    return EFindingStatus.UNKNOWN;
  }
  const now = Math.floor(Date.now() / 1000);

  let assertion: string;
  try {
    assertion = jwt.sign(
      {
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform.read-only',
        aud: GCP_TOKEN_URI,
        iat: now,
        exp: now + 60,
      },
      key.private_key,
      { algorithm: 'RS256' },
    );
  } catch {
    // Malformed private_key (not real PEM) - not our call to make.
    return EFindingStatus.UNKNOWN;
  }

  const res = await fetch(GCP_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 400 || res.status === 401) return EFindingStatus.INVALID;
  if (res.ok) return EFindingStatus.VALID;
  return EFindingStatus.UNKNOWN;
}

// One read-only, side-effect-free request per service - a plain identity/
// "who am I" check, never an action the credential's real owner would
// notice or that touches their data. Services with no entry here always
// resolve to UNKNOWN (see the port's contract) - usually because it
// needs a per-account host we don't know (Shopify shop domain,
// self-hosted Grafana/Vault/Databricks), or isn't a bearer credential at
// all (private keys, OAuth client secrets, webhook signing secrets).
const CHECKERS: Partial<Record<ESecretType, TChecker>> = {
  [ESecretType.AWS_ACCESS_KEY_ID]: async (value, pairedValue) => {
    if (!pairedValue) return EFindingStatus.UNKNOWN;
    return checkAwsCredentials(value, pairedValue);
  },

  [ESecretType.GCP_SERVICE_ACCOUNT_KEY]: (value) =>
    checkGcpServiceAccountKey(value),

  [ESecretType.TELEGRAM_BOT_TOKEN]: async (value) => {
    const res = await fetch(`https://api.telegram.org/bot${value}/getMe`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (!res.ok) return EFindingStatus.UNKNOWN;
    const body: unknown = await res.json();
    const ok =
      typeof body === 'object' &&
      body !== null &&
      (body as { ok?: unknown }).ok === true;
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

  [ESecretType.OPENAI_API_KEY]: (value) =>
    checkBearer('https://api.openai.com/v1/models', value),

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
    const ok =
      typeof body === 'object' &&
      body !== null &&
      (body as { ok?: unknown }).ok === true;
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
    const res = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 404) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.SENDGRID_API_KEY]: (value) =>
    checkBearer('https://api.sendgrid.com/v3/scopes', value),

  // Mailgun authenticates with HTTP Basic, username "api" and the key as
  // the password - there's no Bearer scheme.
  [ESecretType.MAILGUN_API_KEY]: async (value) => {
    const res = await fetch('https://api.mailgun.net/v3/domains', {
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${value}`).toString('base64')}`,
      },
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
      headers: {
        Authorization: `Basic ${Buffer.from(`anystring:${value}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.SQUARE_ACCESS_TOKEN]: async (value) => {
    const res = await fetch('https://connect.squareup.com/v2/locations', {
      headers: {
        Authorization: `Bearer ${value}`,
        'Square-Version': '2024-01-18',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.DIGITALOCEAN_PAT]: checkDigitalOceanToken,
  [ESecretType.DIGITALOCEAN_OAUTH_TOKEN]: checkDigitalOceanToken,

  [ESecretType.AIRTABLE_API_KEY]: (value) =>
    checkBearer('https://api.airtable.com/v0/meta/whoami', value),

  [ESecretType.NOTION_API_TOKEN]: (value) =>
    checkBearer('https://api.notion.com/v1/users/me', value, {
      'Notion-Version': '2022-06-28',
    }),

  [ESecretType.TERRAFORM_CLOUD_TOKEN]: (value) =>
    checkBearer('https://app.terraform.io/api/v2/account/details', value),

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

  [ESecretType.SENTRY_AUTH_TOKEN]: (value) =>
    checkBearer('https://sentry.io/api/0/organizations/', value),

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
    const res = await fetch(
      'https://api.dropboxapi.com/2/users/get_current_account',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  [ESecretType.FACEBOOK_ACCESS_TOKEN]: (value) =>
    checkBearer('https://graph.facebook.com/me', value),

  // App-only bearer token: fetches one public, fixed tweet rather than
  // anything tied to a specific user's account.
  [ESecretType.TWITTER_BEARER_TOKEN]: (value) =>
    checkBearer('https://api.twitter.com/2/tweets?ids=20', value),

  // Fine-grained PATs authenticate the same way classic ghp_ tokens do.
  [ESecretType.GITHUB_FINE_GRAINED_PAT]: checkGithubToken,

  [ESecretType.ASANA_PERSONAL_ACCESS_TOKEN]: (value) =>
    checkBearer('https://app.asana.com/api/1.0/users/me', value),

  [ESecretType.BITBUCKET_ACCESS_TOKEN]: (value) =>
    checkBearer('https://api.bitbucket.org/2.0/user', value),

  // Management API - lists the organizations the token's owner belongs
  // to, no project-level access needed.
  [ESecretType.SUPABASE_PERSONAL_ACCESS_TOKEN]: (value) =>
    checkBearer('https://api.supabase.com/v1/organizations', value),

  [ESecretType.RENDER_API_KEY]: (value) =>
    checkBearer('https://api.render.com/v1/owners', value),

  [ESecretType.CONTENTFUL_PERSONAL_ACCESS_TOKEN]: (value) =>
    checkBearer('https://api.contentful.com/users/me', value),

  // Fly.io's API is GraphQL-only - same read-only-query pattern already
  // used for LINEAR_API_KEY above, never a mutation.
  [ESecretType.FLY_IO_API_TOKEN]: async (value) => {
    const res = await fetch('https://api.fly.io/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ viewer { email } }' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  // LaunchDarkly's auth header is the raw token, no "Bearer" prefix -
  // https://apidocs.launchdarkly.com/#section/Authentication.
  // caller-identity is a purpose-built read-only "who is this token" check.
  [ESecretType.LAUNCHDARKLY_API_ACCESS_TOKEN]: async (value) => {
    const res = await fetch(
      'https://app.launchdarkly.com/api/v2/caller-identity',
      {
        headers: { Authorization: value },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },

  // /v3/me is scoped to personal tokens (dp.pt.) - a valid service/config
  // token (dp.st./dp.ct.) can still 403 here despite being genuinely
  // active, so this check is best-effort like several others above.
  [ESecretType.DOPPLER_TOKEN]: (value) =>
    checkBearer('https://api.doppler.com/v3/me', value),

  // ClickUp's auth header is the raw token too, no "Bearer" prefix -
  // https://developer.clickup.com/docs/authentication.
  [ESecretType.CLICKUP_PERSONAL_API_TOKEN]: async (value) => {
    const res = await fetch('https://api.clickup.com/api/v2/user', {
      headers: { Authorization: value },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return EFindingStatus.INVALID;
    if (res.ok) return EFindingStatus.VALID;
    return EFindingStatus.UNKNOWN;
  },
};

@Injectable()
export class LiveKeyValidatorAdapter extends KeyValidatorPort {
  async validate(
    secretType: ESecretType,
    secretValue: string,
    pairedValue?: string,
  ): Promise<EFindingStatus> {
    return (await this.validateDetailed(secretType, secretValue, pairedValue))
      .status;
  }

  async validateDetailed(
    secretType: ESecretType,
    secretValue: string,
    pairedValue?: string,
  ): Promise<IValidationResult> {
    const unknown = (reason: string): IValidationResult => ({
      status: EFindingStatus.UNKNOWN,
      reason,
    });
    const check = CHECKERS[secretType];
    if (!check)
      return unknown(
        'Skipped: this credential type has no supported validator.',
      );
    if (secretType === ESecretType.AWS_ACCESS_KEY_ID) {
      const credentials = parseAwsCredentials(secretValue);
      if (credentials) {
        secretValue = credentials.access;
        pairedValue = credentials.private;
      } else if (secretValue.trimStart().startsWith('{')) {
        return unknown('Skipped: AWS credentials are incomplete or malformed.');
      }
      if (secretValue.startsWith('ASIA'))
        return unknown(
          'Skipped: temporary AWS credentials require a session token; this validator does not support it.',
        );
      if (!pairedValue)
        return unknown('Skipped: matching AWS Secret Access Key is missing.');
    }
    if (secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY) {
      let key;
      try {
        key = JSON.parse(secretValue);
      } catch {
        return unknown('Skipped: GCP credentials are not valid JSON.');
      }
      if (
        !key ||
        typeof key.private_key !== 'string' ||
        typeof key.client_email !== 'string' ||
        !key.client_email.trim()
      ) {
        return unknown(
          'Skipped: GCP credentials need private_key and client_email.',
        );
      }
      try {
        const parsed = crypto.createPrivateKey(key.private_key);
        if (
          parsed.asymmetricKeyType !== 'rsa' ||
          (parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
        ) {
          return unknown(
            'Skipped: GCP private key must be an RSA key of at least 2048 bits.',
          );
        }
      } catch {
        return unknown('Skipped: GCP private key is not a readable PEM key.');
      }
    }
    try {
      const status = await check(secretValue, pairedValue);
      return {
        status,
        reason:
          status === EFindingStatus.UNKNOWN
            ? 'Inconclusive: provider response did not establish credential validity.'
            : null,
      };
    } catch (error) {
      const name =
        error && typeof error === 'object' && 'name' in error ? error.name : '';
      const cause =
        error && typeof error === 'object' && 'cause' in error
          ? error.cause
          : undefined;
      const coded = cause && typeof cause === 'object' ? cause : error;
      const code =
        coded && typeof coded === 'object' && 'code' in coded
          ? coded.code
          : undefined;
      switch (code) {
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
          return unknown(
            'Inconclusive: provider hostname could not be resolved.',
          );
        case 'ECONNRESET':
        case 'ECONNREFUSED':
        case 'ENETUNREACH':
        case 'EHOSTUNREACH':
        case 'UND_ERR_SOCKET':
          return unknown('Inconclusive: connection to provider failed.');
        case 'CERT_HAS_EXPIRED':
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
          return unknown(
            'Inconclusive: provider TLS certificate could not be verified.',
          );
        case 'ETIMEDOUT':
        case 'UND_ERR_CONNECT_TIMEOUT':
        case 'UND_ERR_HEADERS_TIMEOUT':
        case 'UND_ERR_BODY_TIMEOUT':
          return unknown('Inconclusive: provider request timed out.');
        case 'ERR_INVALID_CHAR':
          return unknown(
            'Skipped: credential cannot be used in an HTTP header.',
          );
      }
      return unknown(
        name === 'TimeoutError' || name === 'AbortError'
          ? 'Inconclusive: provider request timed out.'
          : 'Inconclusive: provider request failed or its response could not be read.',
      );
    }
  }
}
