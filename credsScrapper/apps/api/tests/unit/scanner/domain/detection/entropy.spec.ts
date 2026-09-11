import {
  findHighEntropyTokens,
  shannonEntropy,
} from '../../../../../src/modules/scanner/domain/detection/entropy';

describe('shannonEntropy', () => {
  it('is zero for an empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('is zero for a repeated character', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
  });

  it('is high for a random-looking token', () => {
    expect(shannonEntropy('Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5b')).toBeGreaterThan(4.0);
  });
});

describe('findHighEntropyTokens', () => {
  it('skips short tokens', () => {
    expect(findHighEntropyTokens('short abc123')).toEqual([]);
  });

  it('finds a random-looking token', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    expect(findHighEntropyTokens(`SECRET = '${token}'`)).toContain(token);
  });

  it('skips a low-entropy long token', () => {
    const token = 'a'.repeat(40);
    expect(findHighEntropyTokens(`PADDING = '${token}'`)).not.toContain(token);
  });

  // Real false-positive strings measured against actual scan data before
  // the fix (excluding "/" from the token class, requiring >=2 digits).
  // These must never be flagged as secrets.
  it.each([
    'src/components/coach/ClientActivityLog',
    'CalculationType=ENTEREARNINGSRATE',
    'noPropertyAccessFromIndexSignature',
    'supabase/migrations/20260420054330',
  ])('does not flag known false-positive text: %s', (text: string) => {
    expect(findHighEntropyTokens(text)).toEqual([]);
  });

  it('still flags a real-looking high-entropy token', () => {
    const token = 'DoQpr4WEetHgRDf3uqguqwW35IOb0yzSQnP5QWv1jTw';
    expect(findHighEntropyTokens(token)).toContain(token);
  });
});
