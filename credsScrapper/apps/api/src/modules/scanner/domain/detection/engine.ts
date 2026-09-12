import { ESecretType } from '../constant/secret-type.constant';
import { IFinding } from '../types/finding.type';
import { findHighEntropyTokens } from './entropy';
import { PATTERNS } from './patterns';

// Ported 1:1 from credsScrapper/app/detection/engine.py.

function lineNumberAt(text: string, offset: number): number {
  let count = 0;
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === '\n') {
      count += 1;
    }
  }
  return count + 1;
}

// Docs/tests litter real-looking secrets with placeholder markers (AWS's
// own docs use AKIAIOSFODNN7EXAMPLE as the canonical example key). Only
// "test" is scoped to non-Stripe-test-key types, since sk_test_... is a
// real, sensitive secret type whose own prefix contains the word.
const PLACEHOLDER_MARKERS = ['example', 'placeholder', 'sample', 'changeme', 'dummy', 'fake'];

function isPlaceholder(secretType: ESecretType, value: string, context: string | null): boolean {
  const haystack = `${value} ${context ?? ''}`.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => haystack.includes(marker))) {
    return true;
  }
  return secretType !== ESecretType.STRIPE_TEST_SECRET_KEY && haystack.includes('test');
}

// For generic_high_entropy matches we have no prefix telling us the
// service, so the best available hint is the variable/key name the token
// was assigned to on the same line (e.g. "SUPABASE_KEY = '<token>'" ->
// "SUPABASE_KEY"). Not always present, and never a guarantee of which
// service it belongs to - just a hint for a human reviewing the finding.
const CONTEXT_KEY_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*["']?$/;

function extractContext(text: string, start: number): string | null {
  const searchEnd = start - 1;
  const lineStart = searchEnd < 0 ? -1 : text.lastIndexOf('\n', searchEnd);
  const prefix = text.slice(lineStart + 1, start);
  const match = CONTEXT_KEY_RE.exec(prefix);
  return match ? match[1] : null;
}

export function scanText(text: string): IFinding[] {
  const findings: IFinding[] = [];
  const matchedSpans: Array<[number, number]> = [];

  for (const { secretType, pattern } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const value = match[0];
      matchedSpans.push([start, start + value.length]);
      if (isPlaceholder(secretType, value, null)) {
        continue;
      }
      findings.push({
        secretType,
        secretValue: value,
        lineNumber: lineNumberAt(text, start),
        context: null,
      });
    }
  }

  for (const token of findHighEntropyTokens(text)) {
    const start = text.indexOf(token);
    if (start === -1) {
      continue;
    }
    const overlapsPatternMatch = matchedSpans.some(([s, e]) => start >= s && start < e);
    if (overlapsPatternMatch) {
      continue;
    }
    const context = extractContext(text, start);
    if (isPlaceholder(ESecretType.GENERIC_HIGH_ENTROPY, token, context)) {
      continue;
    }
    findings.push({
      secretType: ESecretType.GENERIC_HIGH_ENTROPY,
      secretValue: token,
      lineNumber: lineNumberAt(text, start),
      context,
    });
  }

  return findings;
}
