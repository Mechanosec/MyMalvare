import re

# Each pattern must match the secret token itself (group(0)) with no
# surrounding context required, since detection.engine.scan_text records
# m.group(0) as the raw finding. Services without a fixed, recognizable
# token prefix/format (e.g. a bare "API key" env var) are intentionally
# left out here and caught instead by the generic entropy detector.
PATTERNS: list[tuple[str, re.Pattern]] = [
    # AWS
    ("aws_access_key_id", re.compile(r"(?:AKIA|ASIA)[0-9A-Z]{16}")),
    # GitHub
    ("github_pat", re.compile(r"ghp_[A-Za-z0-9]{36}")),
    ("github_oauth_token", re.compile(r"gho_[A-Za-z0-9]{36}")),
    ("github_app_token", re.compile(r"(?:ghu|ghs)_[A-Za-z0-9]{36}")),
    ("github_refresh_token", re.compile(r"ghr_[A-Za-z0-9]{76}")),
    # GitLab
    ("gitlab_pat", re.compile(r"glpat-[A-Za-z0-9_\-]{20}")),
    # Slack
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,48}")),
    (
        "slack_webhook_url",
        re.compile(
            r"https://hooks\.slack\.com/services/T[A-Za-z0-9_]{8,10}/"
            r"B[A-Za-z0-9_]{8,10}/[A-Za-z0-9_]{24}"
        ),
    ),
    # Stripe
    ("stripe_live_secret_key", re.compile(r"sk_live_[A-Za-z0-9]{24,}")),
    ("stripe_test_secret_key", re.compile(r"sk_test_[A-Za-z0-9]{24,}")),
    ("stripe_live_publishable_key", re.compile(r"pk_live_[A-Za-z0-9]{24,}")),
    ("stripe_restricted_key", re.compile(r"rk_live_[A-Za-z0-9]{24,}")),
    # Twilio
    ("twilio_api_key", re.compile(r"SK[a-f0-9]{32}")),
    ("twilio_account_sid", re.compile(r"AC[a-f0-9]{32}")),
    # SendGrid
    (
        "sendgrid_api_key",
        re.compile(r"SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}"),
    ),
    # Mailgun
    ("mailgun_api_key", re.compile(r"key-[a-f0-9]{32}")),
    # Mailchimp
    ("mailchimp_api_key", re.compile(r"[a-f0-9]{32}-us[0-9]{1,2}")),
    # Square
    ("square_access_token", re.compile(r"sq0atp-[A-Za-z0-9_\-]{22}")),
    ("square_oauth_secret", re.compile(r"sq0csp-[A-Za-z0-9_\-]{43}")),
    # npm / PyPI / Docker Hub
    ("npm_access_token", re.compile(r"npm_[A-Za-z0-9]{36}")),
    ("pypi_upload_token", re.compile(r"pypi-[A-Za-z0-9_\-]{50,300}")),
    ("dockerhub_pat", re.compile(r"dckr_pat_[A-Za-z0-9_\-]{27}")),
    # JWT (generic, any issuer)
    ("jwt_token", re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+")),
    # Google / Firebase
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("google_oauth_client_secret", re.compile(r"GOCSPX-[A-Za-z0-9_\-]{28}")),
    (
        "firebase_cloud_messaging_key",
        re.compile(r"AAAA[A-Za-z0-9_\-]{7}:[A-Za-z0-9_\-]{140}"),
    ),
    # Discord
    (
        "discord_bot_token",
        re.compile(r"[MN][A-Za-z0-9_\-]{23}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27}"),
    ),
    (
        "discord_webhook_url",
        re.compile(
            r"https://discord(?:app)?\.com/api/webhooks/[0-9]{17,19}/"
            r"[A-Za-z0-9_\-]{60,68}"
        ),
    ),
    # Telegram
    ("telegram_bot_token", re.compile(r"[0-9]{8,10}:AA[A-Za-z0-9_\-]{33}")),
    # Shopify
    ("shopify_access_token", re.compile(r"shpat_[a-fA-F0-9]{32}")),
    ("shopify_shared_secret", re.compile(r"shpss_[a-fA-F0-9]{32}")),
    ("shopify_private_app_token", re.compile(r"shppa_[a-fA-F0-9]{32}")),
    # Facebook / Twitter
    ("facebook_access_token", re.compile(r"EAA[A-Za-z0-9]{20,}")),
    (
        "twitter_bearer_token",
        re.compile(r"AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{35,44}"),
    ),
    # Private keys
    (
        "private_key_pem",
        re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
    ),
    # DigitalOcean
    ("digitalocean_pat", re.compile(r"dop_v1_[a-f0-9]{64}")),
    ("digitalocean_oauth_token", re.compile(r"doo_v1_[a-f0-9]{64}")),
    # PlanetScale
    ("planetscale_password", re.compile(r"pscale_pw_[A-Za-z0-9_\-]{32,64}")),
    ("planetscale_api_token", re.compile(r"pscale_tkn_[A-Za-z0-9_\-]{32,64}")),
    # HashiCorp Vault
    ("hashicorp_vault_token", re.compile(r"hvs\.[A-Za-z0-9_\-]{24,90}")),
    # Airtable
    ("airtable_api_key", re.compile(r"\bkey[A-Za-z0-9]{14}\b")),
    # OpenAI / Anthropic
    ("openai_api_key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9]{20,}")),
    ("anthropic_api_key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{90,120}")),
    # Braintree / PayPal
    (
        "braintree_access_token",
        re.compile(r"access_token\$production\$[0-9a-z]{16}\$[0-9a-f]{32}"),
    ),
]
