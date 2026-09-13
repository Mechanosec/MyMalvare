import { ESecretType } from '../constant/secret-type.constant';
import { IFinding } from '../types/finding.type';
import { findHighEntropyTokens } from './entropy';
import { PATTERNS } from './patterns';

// Ported 1:1 from credsScrapper/app/detection/engine.py.

// Counting newlines from the start of the text on every call is O(text
// length) per finding - fine for a small file, but a real repo's full
// commit-history diff can be 150MB+ with 100k+ findings, which turned a
// single scan into a multi-minute (or effectively infinite) hang.
// Building the newline index once per scanText call and binary-searching
// it makes this O(text length) total instead of O(text length x findings).
function buildLineOffsets(text: string): number[] {
  const offsets: number[] = [];
  let index = text.indexOf('\n');
  while (index !== -1) {
    offsets.push(index);
    index = text.indexOf('\n', index + 1);
  }
  return offsets;
}

function lineNumberAt(lineOffsets: readonly number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lineOffsets[mid] < offset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low + 1;
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

// data: URIs (SVG/CSS/HTML embedding a raster image or font as base64) are
// long, high-entropy blobs of arbitrary bytes - they reliably collide with
// pattern-based detectors like the Facebook/Twitter token regexes and with
// the entropy scanner. They're never a live credential, so the base64
// payload is stripped before scanning (keeping the "data:...;base64," lead-in
// so a stripped blob is still visible in a diff, and staying on one line so
// line numbers of anything else in the file are unaffected).
const DATA_URI_BASE64_RE = /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

function stripDataUriBlobs(text: string): string {
  return text.replace(DATA_URI_BASE64_RE, (match) => match.slice(0, match.indexOf(',') + 1));
}

// Same false-positive source, different shape: a raw MIME/email
// attachment (an .eml/mbox message with a base64-encoded image or Word
// doc) or a uuencoded block is many consecutive lines that are each
// almost entirely base64 alphabet, RFC 2045-wrapped at a fixed width - a
// real inline secret is one token on one line among other text, never a
// multi-line paragraph of nothing but base64. 4+ such lines in a row is
// stripped down to one placeholder line so line numbers of surrounding
// content still line up reasonably.
const MIME_BASE64_BLOCK_RE = /(?:^[A-Za-z0-9+/]{40,}={0,2}[ \t]*\r?\n){4,}/gm;

function stripMimeBase64Blocks(text: string): string {
  return text.replace(MIME_BASE64_BLOCK_RE, '[stripped-base64-block]\n');
}

export function scanText(rawText: string): IFinding[] {
  const text = stripMimeBase64Blocks(stripDataUriBlobs(rawText));
  const lineOffsets = buildLineOffsets(text);
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
        lineNumber: lineNumberAt(lineOffsets, start),
        context: null,
      });
    }
  }

  for (const { token, index: start } of findHighEntropyTokens(text)) {
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
      lineNumber: lineNumberAt(lineOffsets, start),
      context,
    });
  }

  return findings;
}
