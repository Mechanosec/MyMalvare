import { scanText } from '../../../../../src/modules/scanner/domain/detection/engine';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';

const blob = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9'.repeat(3);
const credential = 'DoQpr4WEetHgRDf3uqguqwW35IOb0yzSQnP5QWv1jTw';

describe('embedded media noise', () => {
  it('skips an inline notebook image without hiding a nearby credential', () => {
    const text = `{"image/png":"${blob}","source":"SECRET = '${credential}'"}`;
    expect(scanText(text)).toEqual([
      {
        secretType: ESecretType.GENERIC_HIGH_ENTROPY,
        secretValue: credential,
        lineNumber: 1,
        context: 'SECRET',
      },
    ]);
  });

  it('skips a multiline image array in a unified diff and preserves line numbers', () => {
    const text = `@@ -0,0 +1,5 @@\n+"image/png": [\n+  "${blob}",\n+  "${blob}"\n+]\n+SECRET = '${credential}'`;
    const findings = scanText(text);
    expect(findings).toEqual([
      {
        secretType: ESecretType.GENERIC_HIGH_ENTROPY,
        secretValue: credential,
        lineNumber: 6,
        context: 'SECRET',
      },
    ]);
  });
});
