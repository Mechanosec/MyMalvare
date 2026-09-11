// Ported 1:1 from credsScrapper/app/detection/entropy.py, including the
// false-positive fix validated against real scan data: excluding "/" from
// the token character class (so a path like
// "src/components/coach/ClientActivityLog" is several short segments, not
// one long "token"), allowing "=" only as 0-2 trailing base64 padding
// characters (so "KEY=VALUE" assignments don't get glued into one token),
// and requiring at least MIN_DIGITS digits (real generated secrets almost
// always contain digits; long pure-letter identifiers like
// "noPropertyAccessFromIndexSignature" do not).
export const ENTROPY_THRESHOLD = 4.0;
export const MIN_DIGITS = 2;
export const GENERIC_TOKEN_RE = /[A-Za-z0-9+]{32,}={0,2}/g;

export function shannonEntropy(s: string): number {
  if (s.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const length = s.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function countDigits(s: string): number {
  let count = 0;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      count += 1;
    }
  }
  return count;
}

export function findHighEntropyTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(GENERIC_TOKEN_RE)) {
    const token = match[0];
    if (shannonEntropy(token) > ENTROPY_THRESHOLD && countDigits(token) >= MIN_DIGITS) {
      tokens.push(token);
    }
  }
  return tokens;
}
