import {
  findHighEntropyTokens,
  shannonEntropy,
  shannonEntropyAscii,
} from '../../../../../src/modules/scanner/domain/detection/entropy';

describe('shannonEntropy', () => {
  it('is zero for an empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('is zero for a repeated character', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
  });

  it('is high for a random-looking token', () => {
    expect(shannonEntropy('Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5b')).toBeGreaterThan(
      4.0,
    );
  });
});

describe('shannonEntropyAscii', () => {
  it.each([
    ['', 0],
    ['aaaaaaaa', 0],
    ['aabb', 1],
    ['abcd', 2],
  ])('matches the hand-calculated entropy for %j', (value, expected) => {
    expect(shannonEntropyAscii(value)).toBe(expected);
  });
});

describe('findHighEntropyTokens', () => {
  it('skips short tokens', () => {
    expect(findHighEntropyTokens('short abc123')).toEqual([]);
  });

  it('finds a random-looking token', () => {
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const tokens = findHighEntropyTokens(`SECRET = '${token}'`).map(
      (t) => t.token,
    );
    expect(tokens).toContain(token);
  });

  it('skips a low-entropy long token', () => {
    const token = 'a'.repeat(40);
    const tokens = findHighEntropyTokens(`PADDING = '${token}'`).map(
      (t) => t.token,
    );
    expect(tokens).not.toContain(token);
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
    const tokens = findHighEntropyTokens(token).map((t) => t.token);
    expect(tokens).toContain(token);
  });

  it('reports the exact character index of each token from the regex match, not a re-search', () => {
    // engine.ts used to call text.indexOf(token) to recover this, which
    // is O(text.length) per token - on a large real diff (150MB+, 170k+
    // tokens) that made a single scan take over a minute. Returning the
    // index matchAll already gives us avoids that re-search entirely.
    const token = 'Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9';
    const text = `prefix ${token} suffix`;
    const [result] = findHighEntropyTokens(text);
    expect(result.token).toBe(token);
    expect(result.index).toBe(text.indexOf(token));
  });
});
