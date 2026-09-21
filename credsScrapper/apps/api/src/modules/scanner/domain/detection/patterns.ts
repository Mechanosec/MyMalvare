import { ESecretType } from '../constant/secret-type.constant';
import { ISecretPattern } from '../types/secret-pattern.type';

// Each pattern must match the secret token itself (group 0/match[0]) with no
// surrounding context required, since detection/engine.ts records the whole
// match as the raw finding. Services without a fixed, recognizable
// token prefix/format (e.g. a bare "API key" env var) are intentionally
// left out here and caught instead by the generic entropy detector.
//
// Ported 1:1 from credsScrapper/app/detection/patterns.py.
export const PATTERNS: readonly ISecretPattern[] = [
  // AWS
  {
    secretType: ESecretType.AWS_ACCESS_KEY_ID,
    pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  },
  // AWS secret keys are a bare 40-char base64-ish string with no fixed
  // prefix - unlike every other pattern here, this one requires a
  // assignment-name lookbehind (aws_secret_access_key / secretAccessKey /
  // etc, immediately before an assignment) to have any hope of not
  // matching arbitrary base64 noise. match[0] is still just the 40-char
  // value itself, same contract as every other pattern.
  {
    secretType: ESecretType.AWS_SECRET_ACCESS_KEY,
    requiredMarker:
      /aws_secret_access_key|aws_secret_key|secret_access_key|secretAccessKey|awsSecretAccessKey/i,
    pattern:
      /(?<=(?:aws_secret_access_key|aws_secret_key|secret_access_key|secretAccessKey|awsSecretAccessKey)["\']?\s{0,20}[:=]\s{0,5}["']?)[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/gi,
  },
  // GitHub
  { secretType: ESecretType.GITHUB_PAT, pattern: /ghp_[A-Za-z0-9]{36}/g },
  {
    secretType: ESecretType.GITHUB_OAUTH_TOKEN,
    pattern: /gho_[A-Za-z0-9]{36}/g,
  },
  {
    secretType: ESecretType.GITHUB_APP_TOKEN,
    pattern: /(?:ghu|ghs)_[A-Za-z0-9]{36}/g,
  },
  {
    secretType: ESecretType.GITHUB_REFRESH_TOKEN,
    pattern: /ghr_[A-Za-z0-9]{76}/g,
  },
  // GitLab
  { secretType: ESecretType.GITLAB_PAT, pattern: /glpat-[A-Za-z0-9_-]{20}/g },
  // Slack
  {
    secretType: ESecretType.SLACK_TOKEN,
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,48}/g,
  },
  {
    secretType: ESecretType.SLACK_WEBHOOK_URL,
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]{8,10}\/B[A-Za-z0-9_]{8,10}\/[A-Za-z0-9_]{24}/g,
  },
  // Stripe
  {
    secretType: ESecretType.STRIPE_LIVE_SECRET_KEY,
    pattern: /sk_live_[A-Za-z0-9]{24,}/g,
  },
  {
    secretType: ESecretType.STRIPE_TEST_SECRET_KEY,
    pattern: /sk_test_[A-Za-z0-9]{24,}/g,
  },
  {
    secretType: ESecretType.STRIPE_LIVE_PUBLISHABLE_KEY,
    pattern: /pk_live_[A-Za-z0-9]{24,}/g,
  },
  {
    secretType: ESecretType.STRIPE_RESTRICTED_KEY,
    pattern: /rk_live_[A-Za-z0-9]{24,}/g,
  },
  // Twilio
  { secretType: ESecretType.TWILIO_API_KEY, pattern: /SK[a-f0-9]{32}/g },
  { secretType: ESecretType.TWILIO_ACCOUNT_SID, pattern: /AC[a-f0-9]{32}/g },
  // SendGrid
  {
    secretType: ESecretType.SENDGRID_API_KEY,
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
  },
  // Mailgun
  { secretType: ESecretType.MAILGUN_API_KEY, pattern: /key-[a-f0-9]{32}/g },
  // Mailchimp
  {
    secretType: ESecretType.MAILCHIMP_API_KEY,
    requiredMarker: '-us',
    pattern: /[a-f0-9]{32}-us[0-9]{1,2}/g,
  },
  // Square
  {
    secretType: ESecretType.SQUARE_ACCESS_TOKEN,
    pattern: /sq0atp-[A-Za-z0-9_-]{22}/g,
  },
  {
    secretType: ESecretType.SQUARE_OAUTH_SECRET,
    pattern: /sq0csp-[A-Za-z0-9_-]{43}/g,
  },
  // npm / PyPI / Docker Hub
  { secretType: ESecretType.NPM_ACCESS_TOKEN, pattern: /npm_[A-Za-z0-9]{36}/g },
  {
    secretType: ESecretType.PYPI_UPLOAD_TOKEN,
    pattern: /pypi-[A-Za-z0-9_-]{50,300}/g,
  },
  {
    secretType: ESecretType.DOCKERHUB_PAT,
    pattern: /dckr_pat_[A-Za-z0-9_-]{27}/g,
  },
  // JWT (generic, any issuer)
  {
    secretType: ESecretType.JWT_TOKEN,
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  // Google / Firebase
  { secretType: ESecretType.GOOGLE_API_KEY, pattern: /AIza[0-9A-Za-z_-]{35}/g },
  {
    secretType: ESecretType.GOOGLE_OAUTH_CLIENT_SECRET,
    pattern: /GOCSPX-[A-Za-z0-9_-]{28}/g,
  },
  {
    secretType: ESecretType.FIREBASE_CLOUD_MESSAGING_KEY,
    pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g,
  },
  // Discord
  {
    secretType: ESecretType.DISCORD_BOT_TOKEN,
    pattern: /[MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g,
  },
  {
    secretType: ESecretType.DISCORD_WEBHOOK_URL,
    pattern:
      /https:\/\/discord(?:app)?\.com\/api\/webhooks\/[0-9]{17,19}\/[A-Za-z0-9_-]{60,68}/g,
  },
  // Telegram
  {
    secretType: ESecretType.TELEGRAM_BOT_TOKEN,
    pattern: /[0-9]{8,10}:AA[A-Za-z0-9_-]{33}/g,
  },
  // Shopify
  {
    secretType: ESecretType.SHOPIFY_ACCESS_TOKEN,
    pattern: /shpat_[a-fA-F0-9]{32}/g,
  },
  {
    secretType: ESecretType.SHOPIFY_SHARED_SECRET,
    pattern: /shpss_[a-fA-F0-9]{32}/g,
  },
  {
    secretType: ESecretType.SHOPIFY_PRIVATE_APP_TOKEN,
    pattern: /shppa_[a-fA-F0-9]{32}/g,
  },
  // Facebook / Twitter
  {
    secretType: ESecretType.FACEBOOK_ACCESS_TOKEN,
    pattern: /EAA[A-Za-z0-9]{20,}/g,
  },
  {
    secretType: ESecretType.TWITTER_BEARER_TOKEN,
    pattern: /AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{35,44}/g,
  },
  // Private keys
  {
    secretType: ESecretType.PRIVATE_KEY_PEM,
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  // DigitalOcean
  { secretType: ESecretType.DIGITALOCEAN_PAT, pattern: /dop_v1_[a-f0-9]{64}/g },
  {
    secretType: ESecretType.DIGITALOCEAN_OAUTH_TOKEN,
    pattern: /doo_v1_[a-f0-9]{64}/g,
  },
  // PlanetScale
  {
    secretType: ESecretType.PLANETSCALE_PASSWORD,
    pattern: /pscale_pw_[A-Za-z0-9_-]{32,64}/g,
  },
  {
    secretType: ESecretType.PLANETSCALE_API_TOKEN,
    pattern: /pscale_tkn_[A-Za-z0-9_-]{32,64}/g,
  },
  // HashiCorp Vault
  {
    secretType: ESecretType.HASHICORP_VAULT_TOKEN,
    pattern: /hvs\.[A-Za-z0-9_-]{24,90}/g,
  },
  // Airtable - a real key is 14 random alnum chars; requiring at least one
  // digit rules out the common false positive of an ordinary 14-letter
  // camelCase identifier that happens to start with "key" (e.g.
  // keyTypeFromRoutes, keyboardActiveRef), which the plain \w{14} version
  // reliably matched in bundled/minified JS.
  {
    secretType: ESecretType.AIRTABLE_API_KEY,
    pattern: /\bkey(?=[A-Za-z0-9]{0,13}[0-9])[A-Za-z0-9]{14}\b/g,
  },
  // OpenAI / Anthropic
  {
    secretType: ESecretType.OPENAI_API_KEY,
    pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g,
  },
  {
    secretType: ESecretType.ANTHROPIC_API_KEY,
    pattern: /sk-ant-[A-Za-z0-9_-]{90,120}/g,
  },
  // Braintree / PayPal
  {
    secretType: ESecretType.BRAINTREE_ACCESS_TOKEN,
    pattern: /access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}/g,
  },
  // Private keys (specific formats, in addition to the existing generic PRIVATE_KEY_PEM)
  {
    secretType: ESecretType.OPENSSH_PRIVATE_KEY,
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
  },
  {
    secretType: ESecretType.PGP_PRIVATE_KEY_BLOCK,
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
  },
  // GCP service account key (JSON credentials file)
  {
    secretType: ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    pattern: /"type":\s*"service_account"/g,
  },
  // Azure Storage connection string
  {
    secretType: ESecretType.AZURE_STORAGE_ACCOUNT_KEY,
    pattern: /AccountKey=[A-Za-z0-9+/]{86}==/g,
  },
  // New Relic
  { secretType: ESecretType.NEW_RELIC_API_KEY, pattern: /NRAK-[A-Z0-9]{27}/g },
  // Postman
  {
    secretType: ESecretType.POSTMAN_API_KEY,
    pattern: /PMAK-[a-f0-9]{24}-[a-f0-9]{34}/g,
  },
  // Databricks
  { secretType: ESecretType.DATABRICKS_TOKEN, pattern: /dapi[a-f0-9]{32}/g },
  // Notion
  {
    secretType: ESecretType.NOTION_API_TOKEN,
    pattern: /secret_[A-Za-z0-9]{43}/g,
  },
  // Terraform Cloud
  {
    secretType: ESecretType.TERRAFORM_CLOUD_TOKEN,
    requiredMarker: '.atlasv1.',
    pattern: /[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9-_=]{64,}/g,
  },
  // Linear
  {
    secretType: ESecretType.LINEAR_API_KEY,
    pattern: /lin_api_[A-Za-z0-9]{40}/g,
  },
  // Sentry
  {
    secretType: ESecretType.SENTRY_AUTH_TOKEN,
    pattern: /sntrys_[A-Za-z0-9+/=_-]{40,200}/g,
  },
  // Figma
  {
    secretType: ESecretType.FIGMA_PERSONAL_ACCESS_TOKEN,
    pattern: /figd_[A-Za-z0-9_-]{40}/g,
  },
  // Grafana (base64-encoded {"k":...} blob, no dots - distinct shape from the dot-delimited JWT_TOKEN pattern)
  {
    secretType: ESecretType.GRAFANA_API_KEY,
    pattern: /eyJrIjoi[A-Za-z0-9+/=]{50,300}/g,
  },
  // Dropbox short-lived token
  {
    secretType: ESecretType.DROPBOX_SHORT_LIVED_TOKEN,
    pattern: /sl\.[A-Za-z0-9_-]{130,152}/g,
  },
  // GitHub fine-grained PAT - a distinct, newer format from the classic
  // ghp_ pattern above (GITHUB_PAT), not a replacement for it.
  {
    secretType: ESecretType.GITHUB_FINE_GRAINED_PAT,
    pattern: /github_pat_[A-Za-z0-9_]{80,90}/g,
  },
  // Slack app-level token (xapp-) - distinct from the xox[baprs]- bot/user/
  // legacy tokens already covered by SLACK_TOKEN above.
  {
    secretType: ESecretType.SLACK_APP_LEVEL_TOKEN,
    pattern: /xapp-[0-9]-[A-Za-z0-9]+-[0-9]+-[a-f0-9]{64}/g,
  },
  // Asana personal access token: <user_gid>/<token_gid>:<random hex>. No
  // literal prefix exists for this format (unlike the others below), so
  // the digit count is narrowed to Asana's actual gid length (16-19
  // digits in practice) rather than a wide {9,20} - closer to the real
  // shape lowers the odds of colliding with an unrelated fraction/ratio
  // followed by a hash-shaped suffix.
  {
    secretType: ESecretType.ASANA_PERSONAL_ACCESS_TOKEN,
    pattern: /\d{15,19}\/\d{15,19}:[a-fA-F0-9]{32}/g,
  },
  // Bitbucket repository/workspace/project access token
  {
    secretType: ESecretType.BITBUCKET_ACCESS_TOKEN,
    pattern: /ATCTT3xFfGN0[A-Za-z0-9_=-]{150,270}/g,
  },
  // Supabase personal access token
  {
    secretType: ESecretType.SUPABASE_PERSONAL_ACCESS_TOKEN,
    pattern: /sbp_[a-f0-9]{40}/g,
  },
  // Render API key
  {
    secretType: ESecretType.RENDER_API_KEY,
    pattern: /rnd_[A-Za-z0-9]{20,40}/g,
  },
  // Contentful personal access token
  {
    secretType: ESecretType.CONTENTFUL_PERSONAL_ACCESS_TOKEN,
    pattern: /CFPAT-[A-Za-z0-9_-]{43}/g,
  },
  // Fly.io API token (v2 macaroon)
  {
    secretType: ESecretType.FLY_IO_API_TOKEN,
    pattern: /fm2_[A-Za-z0-9+/_=-]{60,500}/g,
  },
  // LaunchDarkly API access token: api- followed by a UUID. "api-" alone
  // isn't a distinctive brand marker (any identifier could be prefixed
  // that way) - \b requires it start a fresh word, so this can't match
  // inside an unrelated identifier like "myapi-<uuid>".
  {
    secretType: ESecretType.LAUNCHDARKLY_API_ACCESS_TOKEN,
    pattern:
      /\bapi-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
  },
  // Doppler token - dp.pt. (personal), dp.st. (service), dp.ct. (config)
  {
    secretType: ESecretType.DOPPLER_TOKEN,
    pattern: /dp\.(?:pt|st|ct)\.[A-Za-z0-9]{40,44}/g,
  },
  // ClickUp personal API token: pk_<numeric user id>_<32 uppercase alnum>
  {
    secretType: ESecretType.CLICKUP_PERSONAL_API_TOKEN,
    pattern: /pk_\d{7,9}_[A-Z0-9]{32}/g,
  },
];
