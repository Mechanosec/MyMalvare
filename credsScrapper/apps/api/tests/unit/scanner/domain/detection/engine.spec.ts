import { generateKeyPairSync } from 'node:crypto';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { scanText } from '../../../../../src/modules/scanner/domain/detection/engine';
import { PATTERNS } from '../../../../../src/modules/scanner/domain/detection/patterns';

const syntheticPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

describe('scanText', () => {
  it('does not evaluate a pattern when its required marker is absent', () => {
    const entry = PATTERNS.find(
      ({ secretType }) => secretType === ESecretType.TERRAFORM_CLOUD_TOKEN,
    ) as {
      pattern: RegExp;
      requiredMarker?: string;
    };
    const originalPattern = entry.pattern;
    const originalMarker = entry.requiredMarker;
    entry.requiredMarker = '.atlasv1.';
    entry.pattern = {
      [Symbol.matchAll]() {
        throw new Error('expensive pattern should have been skipped');
      },
    } as unknown as RegExp;

    try {
      expect(scanText('ordinary source without the marker')).toEqual([]);
    } finally {
      entry.pattern = originalPattern;
      if (originalMarker === undefined) delete entry.requiredMarker;
      else entry.requiredMarker = originalMarker;
    }
  });

  it('scans a long unrelated identifier before a token without quadratic context matching', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const text = 'a'.repeat(80000) + ';' + token;
    const started = performance.now();
    const findings = scanText(text);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(findings).toContainEqual({
      secretType: ESecretType.GENERIC_HIGH_ENTROPY,
      secretValue: token,
      lineNumber: 1,
      context: null,
    });
  });

  it.each([
    ['123KEY = "', 'KEY'],
    ["obj.KEY:\t'", 'KEY'],
    ['KEY =\n', null],
    ['KEY\n = ', null],
    ['123 = ', null],
    ['_KEY9\u00a0= ', '_KEY9'],
  ])('preserves context for prefix %s', (prefix, context) => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    expect(
      scanText(prefix + token).find((f) => f.secretValue === token)?.context,
    ).toBe(context);
  });

  it('finds a pattern match with the correct line number', () => {
    const text = "line one\nline two\naws_key = 'AKIAABCDEFGH12345678'\n";
    const findings = scanText(text);
    expect(findings).toContainEqual({
      secretType: ESecretType.AWS_ACCESS_KEY_ID,
      secretValue: 'AKIAABCDEFGH12345678',
      lineNumber: 3,
      context: null,
    });
  });

  it('finds a high entropy token', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const findings = scanText(`SECRET = '${token}'\n`);
    expect(
      findings.some(
        (f) =>
          f.secretType === ESecretType.GENERIC_HIGH_ENTROPY &&
          f.secretValue === token,
      ),
    ).toBe(true);
  });

  it('finds nothing in clean code', () => {
    const text =
      "def handler(request, response):\n    return {'status': 'ok'}\n";
    expect(scanText(text)).toEqual([]);
  });

  it('does not double-count a pattern match as an entropy hit', () => {
    const text = "GITHUB_TOKEN = 'ghp_" + 'a'.repeat(36) + "'\n";
    const findings = scanText(text);
    const types = findings.map((f) => f.secretType);
    expect(types.filter((t) => t === ESecretType.GITHUB_PAT)).toHaveLength(1);
    expect(types).not.toContain(ESecretType.GENERIC_HIGH_ENTROPY);
  });

  it('captures context for a high entropy token', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const findings = scanText(`SUPABASE_KEY = '${token}'\n`);
    const match = findings.find(
      (f) => f.secretType === ESecretType.GENERIC_HIGH_ENTROPY,
    );
    expect(match?.context).toBe('SUPABASE_KEY');
  });

  it('context is null without a key name', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const findings = scanText(`random text ${token} more text\n`);
    const match = findings.find(
      (f) => f.secretType === ESecretType.GENERIC_HIGH_ENTROPY,
    );
    expect(match?.context).toBeNull();
  });

  it('pairs a complete JSON credential and preserves an incomplete JSON diff as separate findings', () => {
    const accessId = 'AKIAABCDEFGH12345678';
    const secret = 'q'.repeat(40);
    const findings = scanText(
      JSON.stringify({
        aws_access_key_id: accessId,
        aws_secret_access_key: secret,
      }),
      [ESecretType.AWS_ACCESS_KEY_ID, ESecretType.AWS_SECRET_ACCESS_KEY],
    );
    expect(findings).toHaveLength(1);
    expect(JSON.parse(findings[0].secretValue)).toEqual({
      access: accessId,
      private: secret,
    });

    const partialDiff = `+  "aws_access_key_id": "${accessId}"\n+  "aws_secret_access_key": "${secret}"`;
    const partial = scanText(partialDiff, [
      ESecretType.AWS_ACCESS_KEY_ID,
      ESecretType.AWS_SECRET_ACCESS_KEY,
    ]);
    expect(partial.map((finding) => finding.secretValue)).toEqual([
      accessId,
      secret,
    ]);
  });

  it('a pattern match has no context', () => {
    const findings = scanText("aws_key = 'AKIAABCDEFGH12345678'\n");
    const match = findings.find(
      (f) => f.secretType === ESecretType.AWS_ACCESS_KEY_ID,
    );
    expect(match?.context).toBeNull();
  });

  it("ignores AWS docs' canonical example key", () => {
    const findings = scanText("aws_key = 'AKIAIOSFODNN7EXAMPLE'\n");
    expect(findings).toEqual([]);
  });

  it('ignores a pattern match containing a placeholder marker', () => {
    const findings = scanText(
      "token = 'ghp_" + 'sample'.padEnd(36, 'x') + "'\n",
    );
    expect(findings).toEqual([]);
  });

  it('ignores a high entropy token whose variable name says test', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const findings = scanText(`TEST_API_KEY = '${token}'\n`);
    expect(findings).toEqual([]);
  });

  it('does not exclude a real Stripe test-mode key just for saying "test"', () => {
    const findings = scanText(
      "stripe_key = 'sk_test_" + 'a'.repeat(24) + "'\n",
    );
    expect(findings).toContainEqual({
      secretType: ESecretType.STRIPE_TEST_SECRET_KEY,
      secretValue: 'sk_test_' + 'a'.repeat(24),
      lineNumber: 1,
      context: null,
    });
  });

  it('strips a data: URI base64 blob before scanning, so it cannot produce a false-positive match', () => {
    // A base64 blob this long has a very high chance of coincidentally
    // containing "EAA" followed by 20+ alphanumeric chars (the Facebook
    // access token pattern) or a long run of "A"s (the Twitter bearer
    // token pattern) - exactly what real embedded SVG/CSS assets do.
    const blob =
      'EAAA' + 'B'.repeat(20) + 'AAAAAAAAAAAAAAAAAAAAA' + 'C'.repeat(40);
    const svg = `<image href="data:image/png;base64,${blob}" />\n`;
    expect(scanText(svg)).toEqual([]);
  });

  it('keeps the data:...;base64, lead-in when stripping a blob', () => {
    const svg = 'data:font/woff;base64,AAAA1234\nreal_text_after\n';
    const findings = scanText(svg);
    expect(findings).toEqual([]);
  });

  it('strips a raw MIME/email base64 attachment block before scanning', () => {
    // Simulates a base64-encoded attachment inside a raw .eml/mbox
    // message: several RFC 2045-wrapped lines that are pure base64
    // alphabet, which reliably collide with the Facebook/Twitter
    // patterns and the entropy scanner the same way a data: URI does.
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const line = (seed: number) =>
      Array.from(
        { length: 64 },
        (_, i) => chars[(seed + i) % chars.length],
      ).join('');
    const email =
      'Subject: test\nContent-Transfer-Encoding: base64\n\n' +
      Array.from({ length: 6 }, (_, i) => line(i)).join('\n') +
      '\n\nreal_code_after_the_attachment()\n';
    expect(scanText(email)).toEqual([]);
  });

  it('does not strip a single secret line that happens to look base64-ish', () => {
    const text = "token = 'ghp_" + 'a'.repeat(36) + "'\n";
    const findings = scanText(text);
    expect(findings.map((f) => f.secretType)).toContain(ESecretType.GITHUB_PAT);
  });

  it('captures the whole GCP service account JSON as secretValue, not just the "type": "service_account" marker', () => {
    const key = {
      type: 'service_account',
      project_id: 'my-test-project',
      private_key_id: 'abc123',
      private_key: syntheticPrivateKey,
      client_email: 'svc@my-test-project.iam.gserviceaccount.com',
      client_id: '123456789',
      token_uri: 'https://oauth2.googleapis.com/token',
    };
    const text = `const credentials = ${JSON.stringify(key, null, 2)};\n`;

    const findings = scanText(text);

    const gcpFinding = findings.find(
      (f) => f.secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    );
    expect(gcpFinding).toBeDefined();
    expect(JSON.parse(gcpFinding!.secretValue)).toEqual(key);
  });

  it('captures the whole GCP JSON from unified-diff text where every added line is prefixed with +', () => {
    const key = {
      type: 'service_account',
      project_id: 'my-test-project',
      private_key: syntheticPrivateKey,
      client_email: 'svc@my-test-project.iam.gserviceaccount.com',
    };
    const diffText = `${JSON.stringify(key, null, 2)}\n`
      .split('\n')
      .map((line) => (line.length ? `+${line}` : line))
      .join('\n');

    const findings = scanText(diffText);

    const gcpFinding = findings.find(
      (f) => f.secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    );
    expect(gcpFinding).toBeDefined();
    expect(JSON.parse(gcpFinding!.secretValue)).toEqual(key);
  });

  it('falls back to the bare marker when the surrounding braces do not parse as valid JSON', () => {
    const text =
      'some text "type": "service_account" more text with no real braces around it\n';

    const findings = scanText(text);

    const gcpFinding = findings.find(
      (f) => f.secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    );
    expect(gcpFinding).toBeUndefined();
  });

  it.each([
    'literal } brace',
    'literal { brace',
    'escaped " quote and } brace',
  ])('preserves complete JSON containing %s inside a string', (description) => {
    const key = {
      type: 'service_account',
      project_id: 'example-test-project',
      description,
      private_key: syntheticPrivateKey,
      client_email: 'svc@example-test-project.iam.gserviceaccount.com',
    };
    const finding = scanText(JSON.stringify(key)).find(
      (f) => f.secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY,
    );
    expect(finding).toBeDefined();
    expect(JSON.parse(finding!.secretValue)).toEqual(key);
  });

  it("does not skip a real GCP key as a placeholder just because its project_id says 'test'", () => {
    const key = {
      type: 'service_account',
      project_id: 'my-app-test-1234',
      private_key: syntheticPrivateKey,
      client_email: 'svc@my-app-test-1234.iam.gserviceaccount.com',
    };
    const text = `${JSON.stringify(key)}\n`;

    const findings = scanText(text);

    expect(
      findings.some(
        (f) => f.secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY,
      ),
    ).toBe(true);
  });
});
