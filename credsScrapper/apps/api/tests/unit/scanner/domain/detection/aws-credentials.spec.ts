import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import {
  pairAwsCredentials,
  parseAwsCredentials,
} from '../../../../../src/modules/scanner/domain/detection/aws-credentials';
import { IFinding } from '../../../../../src/modules/scanner/domain/types/finding.type';

const access = 'AKIA' + 'A'.repeat(16);
const secret = 'b'.repeat(40);
const finding = (
  secretType: ESecretType,
  secretValue: string,
  lineNumber: number,
): IFinding => ({ secretType, secretValue, lineNumber, context: null });
const id = (line: number) =>
  finding(ESecretType.AWS_ACCESS_KEY_ID, access, line);
const key = (line: number) =>
  finding(ESecretType.AWS_SECRET_ACCESS_KEY, secret, line);

describe('AWS credential pairing', () => {
  it('pairs one contiguous env block and preserves other findings', () => {
    const other = finding(ESecretType.GITHUB_PAT, 'synthetic', 3);
    const result = pairAwsCredentials(
      `AWS_ACCESS_KEY_ID=${access}\nAWS_SECRET_ACCESS_KEY=${secret}\nother=x`,
      [id(1), key(2), other],
    );
    expect(result).toHaveLength(2);
    expect(parseAwsCredentials(result[0].secretValue)).toEqual({
      access,
      private: secret,
    });
    expect(result[1]).toBe(other);
  });

  it('pairs a flat JSON object and includes optional session token', () => {
    const text = JSON.stringify({
      accessKeyId: access,
      secretAccessKey: secret,
      sessionToken: 'synthetic-token',
    });
    const result = pairAwsCredentials(text, [id(1), key(1)]);
    expect(result).toHaveLength(1);
    expect(parseAwsCredentials(result[0].secretValue)).toEqual({
      access,
      private: secret,
      sessionToken: 'synthetic-token',
    });
  });

  it('keeps separate blocks and diff sides apart', () => {
    expect(
      pairAwsCredentials(
        `AWS_ACCESS_KEY_ID=${access}\n\nAWS_SECRET_ACCESS_KEY=${secret}`,
        [id(1), key(3)],
      ),
    ).toHaveLength(2);
    expect(
      pairAwsCredentials(
        `+AWS_ACCESS_KEY_ID=${access}\n-AWS_SECRET_ACCESS_KEY=${secret}`,
        [id(1), key(2)],
      ),
    ).toHaveLength(2);
    expect(
      pairAwsCredentials(
        `+AWS_ACCESS_KEY_ID=${access}\n@@ -1 +1 @@\n+AWS_SECRET_ACCESS_KEY=${secret}`,
        [id(1), key(3)],
      ),
    ).toHaveLength(2);
  });

  it('pairs same-side diff assignments', () => {
    const result = pairAwsCredentials(
      `+AWS_ACCESS_KEY_ID=${access}\n+AWS_SECRET_ACCESS_KEY=${secret}`,
      [id(1), key(2)],
    );
    expect(result).toHaveLength(1);
  });

  it('preserves ambiguous findings', () => {
    const text = `AWS_ACCESS_KEY_ID=${access}\nAWS_SECRET_ACCESS_KEY=${secret}\nAWS_SECRET_ACCESS_KEY=${secret}`;
    expect(pairAwsCredentials(text, [id(1), key(2), key(3)])).toHaveLength(3);
    expect(parseAwsCredentials(access)).toBeNull();
  });
  it('keeps distinct JSON credential objects separate', () => {
    const secondAccess = 'ASIA' + 'C'.repeat(16);
    const secondSecret = 'd'.repeat(40);
    const text = `${JSON.stringify({ accessKeyId: access, secretAccessKey: secret })}\n${JSON.stringify({ accessKeyId: secondAccess, secretAccessKey: secondSecret })}`;
    const result = pairAwsCredentials(text, [
      id(1),
      key(1),
      finding(ESecretType.AWS_ACCESS_KEY_ID, secondAccess, 2),
      finding(ESecretType.AWS_SECRET_ACCESS_KEY, secondSecret, 2),
    ]);
    expect(result.map((item) => parseAwsCredentials(item.secretValue))).toEqual(
      [
        { access, private: secret },
        { access: secondAccess, private: secondSecret },
      ],
    );
  });

  it('rejects duplicate credential properties hidden by JSON parsing', () => {
    const text = `{"accessKeyId":"${access}","accessKeyId":"${access}","secretAccessKey":"${secret}"}`;
    expect(pairAwsCredentials(text, [id(1), key(1)])).toHaveLength(2);
  });

  it('does not pair different INI profiles or oversized JSON', () => {
    const profiles = `[one]\naws_access_key_id=${access}\n[two]\naws_secret_access_key=${secret}`;
    expect(pairAwsCredentials(profiles, [id(2), key(4)])).toHaveLength(2);
    const huge = `{"padding":"${'x'.repeat(9000)}","accessKeyId":"${access}","secretAccessKey":"${secret}"}`;
    expect(pairAwsCredentials(huge, [id(1), key(1)])).toHaveLength(2);
  });

  it('returns immediately when one credential type is absent', () => {
    expect(pairAwsCredentials('x'.repeat(100000), [id(1)])).toEqual([id(1)]);
  });
  it('removes only an in-scope entropy duplicate of a paired session token', () => {
    const token = 'synthetic-session-token-value';
    const text = `AWS_ACCESS_KEY_ID=${access}\nAWS_SECRET_ACCESS_KEY=${secret}\nAWS_SESSION_TOKEN=${token}\n\nOTHER_TOKEN=${token}`;
    const entropy = finding(ESecretType.GENERIC_HIGH_ENTROPY, token, 3);
    const unrelated = finding(ESecretType.GENERIC_HIGH_ENTROPY, token, 5);
    const result = pairAwsCredentials(text, [
      id(1),
      key(2),
      entropy,
      unrelated,
    ]);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(unrelated);
  });
  it('keeps a long ambiguous env block invalid through its final suffix', () => {
    const text = `AWS_ACCESS_KEY_ID=${access}\nAWS_SECRET_ACCESS_KEY=${secret}\nAWS_SESSION_TOKEN=one\nAWS_SESSION_TOKEN=two\nAWS_ACCESS_KEY_ID=${access}\nAWS_SECRET_ACCESS_KEY=${secret}`;
    expect(
      pairAwsCredentials(text, [id(1), key(2), id(5), key(6)]),
    ).toHaveLength(4);
  });

  it('does not treat malformed JSON fields as env assignments', () => {
    const text = `{"accessKeyId":"${access}",\n"secretAccessKey":"${secret}"`;
    expect(pairAwsCredentials(text, [id(1), key(2)])).toHaveLength(2);
  });

  it('rejects duplicate fields in multiline flat JSON', () => {
    const text = `{\n"accessKeyId":"${access}",\n"accessKeyId":"${access}",\n"secretAccessKey":"${secret}"\n}`;
    expect(pairAwsCredentials(text, [id(2), id(3), key(4)])).toHaveLength(3);
  });
  it('pairs distinct credential objects on one line without crossing them', () => {
    const secondAccess = 'ASIA' + 'C'.repeat(16);
    const secondSecret = 'd'.repeat(40);
    const text = `${JSON.stringify({ accessKeyId: access, secretAccessKey: secret })} ${JSON.stringify({ accessKeyId: secondAccess, secretAccessKey: secondSecret })}`;
    const result = pairAwsCredentials(text, [
      id(1),
      key(1),
      finding(ESecretType.AWS_ACCESS_KEY_ID, secondAccess, 1),
      finding(ESecretType.AWS_SECRET_ACCESS_KEY, secondSecret, 1),
    ]);
    expect(result.map((item) => parseAwsCredentials(item.secretValue))).toEqual(
      [
        { access, private: secret },
        { access: secondAccess, private: secondSecret },
      ],
    );
  });

  it('leaves repeated same-line credential values ambiguous', () => {
    const object = JSON.stringify({
      accessKeyId: access,
      secretAccessKey: secret,
    });
    expect(
      pairAwsCredentials(`${object} ${object}`, [id(1), id(1), key(1), key(1)]),
    ).toHaveLength(4);
  });
  it('keeps same-line session token values when another object repeats the value', () => {
    const token = 'synthetic-session-token-value';
    const text = `${JSON.stringify({ accessKeyId: access, secretAccessKey: secret, sessionToken: token })} ${JSON.stringify({ unrelatedToken: token })}`;
    const duplicate = finding(ESecretType.GENERIC_HIGH_ENTROPY, token, 1);
    const unrelated = finding(ESecretType.GENERIC_HIGH_ENTROPY, token, 1);
    const result = pairAwsCredentials(text, [
      id(1),
      key(1),
      duplicate,
      unrelated,
    ]);
    expect(result).toHaveLength(3);
    expect(result).toContain(duplicate);
    expect(result).toContain(unrelated);
  });
  it.each(['+', '-'])('pairs a complete %s-side JSON diff object', (side) => {
    const text = `${side}{\n${side}  "accessKeyId": "${access}",\n${side}  "secretAccessKey": "${secret}"\n${side}}`;
    const result = pairAwsCredentials(text, [id(2), key(3)]);
    expect(result).toHaveLength(1);
    expect(parseAwsCredentials(result[0].secretValue)).toEqual({
      access,
      private: secret,
    });
  });

  it('keeps mixed-side and cross-hunk JSON diff findings separate', () => {
    const mixed = `+{\n+  "accessKeyId": "${access}",\n-  "secretAccessKey": "${secret}"\n+}`;
    const hunk = `+{\n+  "accessKeyId": "${access}",\n@@ -1 +1 @@\n+  "secretAccessKey": "${secret}"\n+}`;
    expect(pairAwsCredentials(mixed, [id(2), key(3)])).toHaveLength(2);
    expect(pairAwsCredentials(hunk, [id(2), key(4)])).toHaveLength(2);
  });
});
