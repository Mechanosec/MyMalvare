import { createHash, generateKeyPairSync } from 'node:crypto';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { scanText } from '../../../../../src/modules/scanner/domain/detection/engine';

const facebook = 'EAA' + 'Ab3d'.repeat(8);
const twitter = 'AAAAAAAAAAAAAAAAAAAAA' + 'Ab3d'.repeat(15);
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const gcp = (private_key = pem) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'example-test-project',
    private_key,
    client_email: 'svc@example-test-project.iam.gserviceaccount.com',
  });

const sriDigest = (algorithm: 'sha256' | 'sha384' | 'sha512', seed: number) =>
  createHash(algorithm)
    .update(`synthetic sri fixture ${seed}`)
    .digest('base64');

describe('detection quality', () => {
  it.each([
    [ESecretType.FACEBOOK_ACCESS_TOKEN, facebook],
    [ESecretType.TWITTER_BEARER_TOKEN, twitter],
  ])(
    'keeps a complete standalone %s and rejects embedded substrings',
    (type, token) => {
      expect(scanText(`TOKEN = "${token}"`, [type])).toHaveLength(1);
      expect(scanText(`x/${token}+y`, [type])).toEqual([]);
      expect(scanText(`x_${token}-y`, [type])).toEqual([]);
      expect(scanText(`Z${token}Z`, [type])).toEqual([]);
      expect(scanText(`${token}=`, [type])).toEqual([]);
    },
  );

  it.each([
    [ESecretType.FACEBOOK_ACCESS_TOKEN, facebook],
    [ESecretType.TWITTER_BEARER_TOKEN, twitter],
  ])('detects %s on an added unified-diff line', (type, token) => {
    const diff = `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+${token}\n`;
    expect(scanText(diff, [type])[0]?.secretValue).toBe(token);
    expect(
      scanText(diff.replace(`+${token}`, `-${token}`), [type])[0]?.secretValue,
    ).toBe(token);
    expect(scanText(`+${token}`, [type])).toEqual([]);
  });

  it('does not truncate a long Twitter bearer token', () => {
    const findings = scanText(twitter, [ESecretType.TWITTER_BEARER_TOKEN]);
    expect(findings[0]?.secretValue).toBe(twitter);
  });

  it('requires a complete GCP service account with a PEM-shaped private key', () => {
    expect(scanText(gcp(), [ESecretType.GCP_SERVICE_ACCOUNT_KEY])).toHaveLength(
      1,
    );
    for (const text of [
      '"type": "service_account"',
      gcp('synthetic-only'),
      gcp(
        '-----BEGIN PRIVATE KEY-----\n' +
          'QUJD'.repeat(20) +
          '\n-----END PRIVATE KEY-----\n',
      ),
      gcp('-----BEGIN PRIVATE KEY-----\nabc\n'),
      JSON.stringify({ type: 'service_account', private_key: pem }),
    ]) {
      expect(scanText(text, [ESecretType.GCP_SERVICE_ACCOUNT_KEY])).toEqual([]);
    }
  });

  it('does not turn a rejected GCP JSON private key into an entropy finding', () => {
    const invalid = gcp('Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z');
    expect(scanText(invalid)).toEqual([]);
  });

  it('keeps an api_key beside a rejected GCP private_key', () => {
    const text =
      'header\n' +
      JSON.stringify({
        type: 'service_account',
        project_id: 'synthetic-project',
        private_key: sriDigest('sha256', 0),
        client_email: 'svc@synthetic-project.iam.gserviceaccount.com',
        api_key: sriDigest('sha384', 1),
      });
    const findings = scanText(text);
    const generic = findings.filter(
      (finding) => finding.secretType === ESecretType.GENERIC_HIGH_ENTROPY,
    );
    expect(generic.length).toBe(1);
    expect(generic[0]?.secretValue === sriDigest('sha384', 1)).toBe(true);
    expect(generic[0]?.lineNumber).toBe(2);
    expect(
      findings.filter(
        (finding) => finding.secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY,
      ).length,
    ).toBe(0);
  });

  it('rejects a GCP JSON credential assembled from opposite diff sides', () => {
    const lines = JSON.stringify(JSON.parse(gcp()), null, 2).split('\n');
    const mixed = lines
      .map((line, index) => `${index < 3 ? '+' : '-'}${line}`)
      .join('\n');
    expect(scanText(mixed, [ESecretType.GCP_SERVICE_ACCOUNT_KEY]).length).toBe(
      0,
    );
    const mixedWithContext = lines
      .map((line, index) => `${[' ', '+', ' ', '-', ' ', ' '][index]}${line}`)
      .join('\n');
    expect(
      scanText(mixedWithContext, [ESecretType.GCP_SERVICE_ACCOUNT_KEY]).length,
    ).toBe(0);
  });

  it.each([
    ['added side with context', ['+', ' ', '+', ' ', '+', '+']],
    ['removed side with context', ['-', ' ', '-', ' ', '-', '-']],
    ['context opening brace with added lines', [' ', '+', ' ', '+', '+', ' ']],
  ])('accepts a GCP diff with %s', (_description, markers) => {
    const lines = JSON.stringify(JSON.parse(gcp()), null, 2).split('\n');
    const diff = `header\n${lines.map((line, index) => `${markers[index]}${line}`).join('\n')}`;
    const findings = scanText(diff, [ESecretType.GCP_SERVICE_ACCOUNT_KEY]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.lineNumber).toBe(2);
  });

  it('accepts a same-side GCP diff and rejects a split across hunks', () => {
    const lines = JSON.stringify(JSON.parse(gcp()), null, 2).split('\n');
    const added = lines.map((line) => `+${line}`);
    const sameSide = `header\n${added.join('\n')}`;
    const complete = scanText(sameSide, [ESecretType.GCP_SERVICE_ACCOUNT_KEY]);
    expect(complete.length).toBe(1);
    expect(complete[0]?.lineNumber).toBe(2);

    const split = [
      ...added.slice(0, 3),
      '@@ -9,1 +10,1 @@',
      ...added.slice(3),
    ].join('\n');
    expect(scanText(split, [ESecretType.GCP_SERVICE_ACCOUNT_KEY]).length).toBe(
      0,
    );
  });

  it('keeps line positions after a stripped MIME base64 block', () => {
    const blob = 'A'.repeat(64) + '\n';
    const findings = scanText(blob.repeat(4) + facebook, [
      ESecretType.FACEBOOK_ACCESS_TOKEN,
    ]);
    expect(findings[0]?.lineNumber).toBe(5);
  });

  it('does not emit entropy duplicates within a specific token', () => {
    const findings = scanText(`TOKEN = "${facebook}"`);
    expect(
      findings.some((f) => f.secretType === ESecretType.FACEBOOK_ACCESS_TOKEN),
    ).toBe(true);
    expect(
      findings.some((f) => f.secretType === ESecretType.GENERIC_HIGH_ENTROPY),
    ).toBe(false);
  });

  it.each([
    ['sha256', 0],
    ['sha384', 1],
    ['sha512', 1],
  ] as const)(
    'suppresses complete %s SRI in HTML integrity',
    (algorithm, seed) => {
      const digest = sriDigest(algorithm, seed);
      expect(
        scanText(`const key = "${digest}"`, [ESecretType.GENERIC_HIGH_ENTROPY]),
      ).toHaveLength(1);
      expect(
        scanText(`<script integrity="${algorithm}-${digest}"></script>`, [
          ESecretType.GENERIC_HIGH_ENTROPY,
        ]),
      ).toEqual([]);
    },
  );

  it('suppresses each complete SRI checksum in one JSON integrity field', () => {
    const value = [
      `sha256-${sriDigest('sha256', 0)}`,
      `sha384-${sriDigest('sha384', 1)}`,
      `sha512-${sriDigest('sha512', 1)}`,
    ].join(' ');
    expect(
      scanText(JSON.stringify({ integrity: value }), [
        ESecretType.GENERIC_HIGH_ENTROPY,
      ]),
    ).toEqual([]);
  });

  it('suppresses SRI checksums on added HTML and JSON diff lines', () => {
    const checksum = `sha256-${sriDigest('sha256', 0)}`;
    for (const added of [
      `+<script integrity="${checksum}"></script>`,
      `+${JSON.stringify({ integrity: checksum })}`,
    ]) {
      expect(
        scanText(`header\n${added}`, [ESecretType.GENERIC_HIGH_ENTROPY]).length,
      ).toBe(0);
    }
  });

  it('keeps SRI-shaped tokens outside an explicit integrity attribute or field', () => {
    const checksum = `sha256-${sriDigest('sha256', 0)}`;
    for (const text of [
      `<script data-integrity="${checksum}"></script>`,
      JSON.stringify({ checksum }),
      `{"integrity': "${checksum}"}`,
      `const integrity = "${checksum}";`,
    ]) {
      expect(scanText(text, [ESecretType.GENERIC_HIGH_ENTROPY])).toHaveLength(
        1,
      );
    }
  });

  it('keeps a malformed checksum and a neighboring generic token', () => {
    const digest = sriDigest('sha256', 0);
    const invalid = `sha256-${digest.slice(0, -1)}`;
    const malformed = `<script integrity="${invalid}"></script>`;
    expect(
      scanText(malformed, [ESecretType.GENERIC_HIGH_ENTROPY]),
    ).toHaveLength(1);

    const text = `header\n<script integrity="sha256-${digest}" data-key="${digest}"></script>`;
    const findings = scanText(text, [ESecretType.GENERIC_HIGH_ENTROPY]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.lineNumber).toBe(2);
  });

  it('keeps specific-token detection beside an SRI checksum', () => {
    const text = `<script integrity="sha256-${sriDigest('sha256', 0)}" data-key="${facebook}"></script>`;
    const findings = scanText(text);
    expect(
      findings.filter(
        (finding) => finding.secretType === ESecretType.FACEBOOK_ACCESS_TOKEN,
      ),
    ).toHaveLength(1);
    expect(
      findings.filter(
        (finding) => finding.secretType === ESecretType.GENERIC_HIGH_ENTROPY,
      ),
    ).toEqual([]);
  });
});
