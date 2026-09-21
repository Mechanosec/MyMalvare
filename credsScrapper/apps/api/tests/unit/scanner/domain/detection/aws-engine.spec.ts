import { scanText } from '../../../../../src/modules/scanner/domain/detection/engine';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

const access = 'AKIAQ7W8E9R2T3Y4U5I6';
const privateKey = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7aB3dE6gH9jK2m';
const env = `AWS_ACCESS_KEY_ID="${access}"\nAWS_SECRET_ACCESS_KEY="${privateKey}"`;

describe('AWS pair detection integration', () => {
  it('stores a complete credential as one JSON finding', () => {
    const results = scanText(env);
    expect(results).toEqual([
      {
        secretType: ESecretType.AWS_ACCESS_KEY_ID,
        secretValue: JSON.stringify({ access, private: privateKey }),
        lineNumber: 1,
        context: null,
      },
    ]);
  });

  it('collects the private half when only AWS access credentials are requested', () => {
    const results = scanText(env, [ESecretType.AWS_ACCESS_KEY_ID]);
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].secretValue)).toEqual({
      access,
      private: privateKey,
    });
  });

  it('keeps a private-only filter and orphan access IDs usable', () => {
    expect(
      scanText(env, [ESecretType.AWS_SECRET_ACCESS_KEY]).map(
        (f) => f.secretValue,
      ),
    ).toEqual([privateKey]);
    expect(
      scanText(`AWS_ACCESS_KEY_ID=${access}`, [
        ESecretType.AWS_ACCESS_KEY_ID,
      ]).map((f) => f.secretValue),
    ).toEqual([access]);
  });

  it('pairs an added diff block without mixing removed and added credentials', () => {
    const diff = `@@ -0,0 +1,2 @@\n+AWS_ACCESS_KEY_ID=${access}\n+AWS_SECRET_ACCESS_KEY=${privateKey}`;
    expect(scanText(diff, [ESecretType.AWS_ACCESS_KEY_ID])[0].secretValue).toBe(
      JSON.stringify({ access, private: privateKey }),
    );
    const mixed = `@@ -1 +1 @@\n-AWS_ACCESS_KEY_ID=${access}\n+AWS_SECRET_ACCESS_KEY=${privateKey}`;
    expect(
      scanText(mixed, [ESecretType.AWS_ACCESS_KEY_ID])[0].secretValue,
    ).toBe(access);
  });
});
