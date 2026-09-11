import pytest

from app.detection.patterns import PATTERNS

SAMPLES = [
    ("aws_access_key_id", "AKIAABCDEFGH12345678"),
    ("github_pat", "ghp_" + "a" * 36),
    ("github_oauth_token", "gho_" + "a" * 36),
    ("github_app_token", "ghu_" + "a" * 36),
    ("github_refresh_token", "ghr_" + "a" * 76),
    ("gitlab_pat", "glpat-" + "a" * 20),
    ("slack_token", "xoxb-1234567890"),
    (
        "slack_webhook_url",
        "https://hooks.slack.com/services/T12345678/B12345678/" + "a" * 24,
    ),
    ("stripe_live_secret_key", "sk_live_" + "b" * 24),
    ("stripe_test_secret_key", "sk_test_" + "b" * 24),
    ("stripe_live_publishable_key", "pk_live_" + "b" * 24),
    ("stripe_restricted_key", "rk_live_" + "b" * 24),
    ("twilio_api_key", "SK" + "a" * 32),
    ("twilio_account_sid", "AC" + "a" * 32),
    ("sendgrid_api_key", "SG." + "a" * 22 + "." + "b" * 43),
    ("mailgun_api_key", "key-" + "a" * 32),
    ("mailchimp_api_key", "a" * 32 + "-us12"),
    ("square_access_token", "sq0atp-" + "a" * 22),
    ("square_oauth_secret", "sq0csp-" + "a" * 43),
    ("npm_access_token", "npm_" + "a" * 36),
    ("pypi_upload_token", "pypi-" + "a" * 50),
    ("dockerhub_pat", "dckr_pat_" + "a" * 27),
    ("jwt_token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123-_XYZ"),
    ("google_api_key", "AIza" + "a" * 35),
    ("google_oauth_client_secret", "GOCSPX-" + "a" * 28),
    ("firebase_cloud_messaging_key", "AAAA" + "a" * 7 + ":" + "b" * 140),
    ("discord_bot_token", "M" + "a" * 23 + "." + "b" * 6 + "." + "c" * 27),
    (
        "discord_webhook_url",
        "https://discord.com/api/webhooks/" + "1" * 18 + "/" + "a" * 60,
    ),
    ("telegram_bot_token", "123456789:AA" + "a" * 33),
    ("shopify_access_token", "shpat_" + "a" * 32),
    ("shopify_shared_secret", "shpss_" + "a" * 32),
    ("shopify_private_app_token", "shppa_" + "a" * 32),
    ("facebook_access_token", "EAA" + "a" * 20),
    ("twitter_bearer_token", "AAAAAAAAAAAAAAAAAAAAA" + "a" * 40),
    ("private_key_pem", "-----BEGIN RSA PRIVATE KEY-----"),
    ("digitalocean_pat", "dop_v1_" + "a" * 64),
    ("digitalocean_oauth_token", "doo_v1_" + "a" * 64),
    ("planetscale_password", "pscale_pw_" + "a" * 32),
    ("planetscale_api_token", "pscale_tkn_" + "a" * 32),
    ("hashicorp_vault_token", "hvs." + "a" * 24),
    ("airtable_api_key", "key" + "a" * 14),
    ("openai_api_key", "sk-" + "a" * 20),
    ("anthropic_api_key", "sk-ant-" + "a" * 90),
    (
        "braintree_access_token",
        "access_token$production$" + "1234567890abcdef" + "$" + "a" * 32,
    ),
]


def _match_any(text):
    hits = []
    for secret_type, pattern in PATTERNS:
        for m in pattern.finditer(text):
            hits.append((secret_type, m.group(0)))
    return hits


def test_pattern_coverage_matches_sample_table():
    pattern_names = {name for name, _ in PATTERNS}
    sample_names = {name for name, _ in SAMPLES}
    assert pattern_names == sample_names


@pytest.mark.parametrize("secret_type,sample", SAMPLES)
def test_pattern_detects_its_sample(secret_type, sample):
    hits = _match_any(f"TOKEN = '{sample}'")
    assert (secret_type, sample) in hits


def test_no_false_positive_on_normal_code():
    hits = _match_any("def handler(request, response):\n    return {'status': 'ok'}")
    assert hits == []
