import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { scanText } from '../../../../../src/modules/scanner/domain/detection/engine';

describe('scanText', () => {
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
        (f) => f.secretType === ESecretType.GENERIC_HIGH_ENTROPY && f.secretValue === token,
      ),
    ).toBe(true);
  });

  it('finds nothing in clean code', () => {
    const text = "def handler(request, response):\n    return {'status': 'ok'}\n";
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
    const match = findings.find((f) => f.secretType === ESecretType.GENERIC_HIGH_ENTROPY);
    expect(match?.context).toBe('SUPABASE_KEY');
  });

  it('context is null without a key name', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const findings = scanText(`random text ${token} more text\n`);
    const match = findings.find((f) => f.secretType === ESecretType.GENERIC_HIGH_ENTROPY);
    expect(match?.context).toBeNull();
  });

  it('a pattern match has no context', () => {
    const findings = scanText("aws_key = 'AKIAABCDEFGH12345678'\n");
    const match = findings.find((f) => f.secretType === ESecretType.AWS_ACCESS_KEY_ID);
    expect(match?.context).toBeNull();
  });
});
