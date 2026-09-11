import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { PATTERNS } from '../../../../../src/modules/scanner/domain/detection/patterns';

const SAMPLES: Array<[ESecretType, string]> = [
  [ESecretType.AWS_ACCESS_KEY_ID, 'AKIAABCDEFGH12345678'],
  [ESecretType.GITHUB_PAT, 'ghp_' + 'a'.repeat(36)],
  [ESecretType.GITHUB_OAUTH_TOKEN, 'gho_' + 'a'.repeat(36)],
  [ESecretType.GITHUB_APP_TOKEN, 'ghu_' + 'a'.repeat(36)],
  [ESecretType.GITHUB_REFRESH_TOKEN, 'ghr_' + 'a'.repeat(76)],
  [ESecretType.GITLAB_PAT, 'glpat-' + 'a'.repeat(20)],
  [ESecretType.SLACK_TOKEN, 'xoxb-1234567890'],
  [
    ESecretType.SLACK_WEBHOOK_URL,
    'https://hooks.slack.com/services/T12345678/B12345678/' + 'a'.repeat(24),
  ],
  [ESecretType.STRIPE_LIVE_SECRET_KEY, 'sk_live_' + 'b'.repeat(24)],
  [ESecretType.STRIPE_TEST_SECRET_KEY, 'sk_test_' + 'b'.repeat(24)],
  [ESecretType.STRIPE_LIVE_PUBLISHABLE_KEY, 'pk_live_' + 'b'.repeat(24)],
  [ESecretType.STRIPE_RESTRICTED_KEY, 'rk_live_' + 'b'.repeat(24)],
  [ESecretType.TWILIO_API_KEY, 'SK' + 'a'.repeat(32)],
  [ESecretType.TWILIO_ACCOUNT_SID, 'AC' + 'a'.repeat(32)],
  [ESecretType.SENDGRID_API_KEY, 'SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(43)],
  [ESecretType.MAILGUN_API_KEY, 'key-' + 'a'.repeat(32)],
  [ESecretType.MAILCHIMP_API_KEY, 'a'.repeat(32) + '-us12'],
  [ESecretType.SQUARE_ACCESS_TOKEN, 'sq0atp-' + 'a'.repeat(22)],
  [ESecretType.SQUARE_OAUTH_SECRET, 'sq0csp-' + 'a'.repeat(43)],
  [ESecretType.NPM_ACCESS_TOKEN, 'npm_' + 'a'.repeat(36)],
  [ESecretType.PYPI_UPLOAD_TOKEN, 'pypi-' + 'a'.repeat(50)],
  [ESecretType.DOCKERHUB_PAT, 'dckr_pat_' + 'a'.repeat(27)],
  [ESecretType.JWT_TOKEN, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123-_XYZ'],
  [ESecretType.GOOGLE_API_KEY, 'AIza' + 'a'.repeat(35)],
  [ESecretType.GOOGLE_OAUTH_CLIENT_SECRET, 'GOCSPX-' + 'a'.repeat(28)],
  [ESecretType.FIREBASE_CLOUD_MESSAGING_KEY, 'AAAA' + 'a'.repeat(7) + ':' + 'b'.repeat(140)],
  [ESecretType.DISCORD_BOT_TOKEN, 'M' + 'a'.repeat(23) + '.' + 'b'.repeat(6) + '.' + 'c'.repeat(27)],
  [
    ESecretType.DISCORD_WEBHOOK_URL,
    'https://discord.com/api/webhooks/' + '1'.repeat(18) + '/' + 'a'.repeat(60),
  ],
  [ESecretType.TELEGRAM_BOT_TOKEN, '123456789:AA' + 'a'.repeat(33)],
  [ESecretType.SHOPIFY_ACCESS_TOKEN, 'shpat_' + 'a'.repeat(32)],
  [ESecretType.SHOPIFY_SHARED_SECRET, 'shpss_' + 'a'.repeat(32)],
  [ESecretType.SHOPIFY_PRIVATE_APP_TOKEN, 'shppa_' + 'a'.repeat(32)],
  [ESecretType.FACEBOOK_ACCESS_TOKEN, 'EAA' + 'a'.repeat(20)],
  [ESecretType.TWITTER_BEARER_TOKEN, 'AAAAAAAAAAAAAAAAAAAAA' + 'a'.repeat(40)],
  [ESecretType.PRIVATE_KEY_PEM, '-----BEGIN RSA PRIVATE KEY-----'],
  [ESecretType.DIGITALOCEAN_PAT, 'dop_v1_' + 'a'.repeat(64)],
  [ESecretType.DIGITALOCEAN_OAUTH_TOKEN, 'doo_v1_' + 'a'.repeat(64)],
  [ESecretType.PLANETSCALE_PASSWORD, 'pscale_pw_' + 'a'.repeat(32)],
  [ESecretType.PLANETSCALE_API_TOKEN, 'pscale_tkn_' + 'a'.repeat(32)],
  [ESecretType.HASHICORP_VAULT_TOKEN, 'hvs.' + 'a'.repeat(24)],
  [ESecretType.AIRTABLE_API_KEY, 'key' + 'a'.repeat(14)],
  [ESecretType.OPENAI_API_KEY, 'sk-' + 'a'.repeat(20)],
  [ESecretType.ANTHROPIC_API_KEY, 'sk-ant-' + 'a'.repeat(90)],
  [
    ESecretType.BRAINTREE_ACCESS_TOKEN,
    'access_token$production$1234567890abcdef$' + 'a'.repeat(32),
  ],
];

function matchAny(text: string): Array<[ESecretType, string]> {
  const hits: Array<[ESecretType, string]> = [];
  for (const { secretType, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      hits.push([secretType, match[0]]);
    }
  }
  return hits;
}

describe('PATTERNS', () => {
  it('has a sample for every declared secret type and vice versa', () => {
    const patternTypes = new Set(PATTERNS.map((p) => p.secretType));
    const sampleTypes = new Set(SAMPLES.map(([type]) => type));
    expect(patternTypes).toEqual(sampleTypes);
  });

  it.each(SAMPLES)('detects %s from its sample token', (secretType: ESecretType, sample: string) => {
    const hits = matchAny(`TOKEN = '${sample}'`);
    expect(hits).toContainEqual([secretType, sample]);
  });

  it('does not false-positive on normal code', () => {
    const hits = matchAny("def handler(request, response):\n    return {'status': 'ok'}");
    expect(hits).toEqual([]);
  });
});
