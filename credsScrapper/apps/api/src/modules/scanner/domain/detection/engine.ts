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
const PLACEHOLDER_MARKERS = [
  'example',
  'placeholder',
  'sample',
  'changeme',
  'dummy',
  'fake',
];

// GCP_SERVICE_ACCOUNT_KEY's secretValue is the whole credentials JSON
// (see extractGcpServiceAccountJson above), not a single token - a real
// key's own project_id/client_email fields commonly contain "test" (a
// GCP test/staging project) or even "example"/"sample" (a project named
// after a demo app), which would otherwise make this heuristic silently
// drop a genuine, high-severity leaked key. path-exclusion.ts's
// test/fixture-directory skip is this type's actual placeholder defense.
const PLACEHOLDER_SKIP_EXEMPT = new Set([ESecretType.GCP_SERVICE_ACCOUNT_KEY]);

function isPlaceholder(
  secretType: ESecretType,
  value: string,
  context: string | null,
): boolean {
  if (PLACEHOLDER_SKIP_EXEMPT.has(secretType)) {
    return false;
  }
  const haystack = `${value} ${context ?? ''}`.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => haystack.includes(marker))) {
    return true;
  }
  return (
    secretType !== ESecretType.STRIPE_TEST_SECRET_KEY &&
    haystack.includes('test')
  );
}

// For generic_high_entropy matches we have no prefix telling us the
// service, so the best available hint is the variable/key name the token
// was assigned to on the same line (e.g. "SUPABASE_KEY = '<token>'" ->
// "SUPABASE_KEY"). Not always present, and never a guarantee of which
// service it belongs to - just a hint for a human reviewing the finding.
function extractContext(text: string, start: number): string | null {
  // Read only the assignment immediately before the token. Searching the
  // entire line with an unanchored identifier regex retries long identifiers
  // at every character, taking quadratic time on bundled/minified source.
  let end = start;
  if (text[end - 1] === '"' || text[end - 1] === "'") end--;
  const skipWhitespace = () => {
    while (end > 0 && text[end - 1] !== '\n' && /\s/.test(text[end - 1])) end--;
  };
  skipWhitespace();
  if (text[end - 1] !== ':' && text[end - 1] !== '=') return null;
  end--;
  skipWhitespace();
  let begin = end;
  while (begin > 0 && /[A-Za-z0-9_]/.test(text[begin - 1])) begin--;
  // The previous regex also accepted an identifier suffix after digits.
  while (begin < end && /[0-9]/.test(text[begin])) begin++;
  return begin < end ? text.slice(begin, end) : null;
}

// data: URIs (SVG/CSS/HTML embedding a raster image or font as base64) are
// long, high-entropy blobs of arbitrary bytes - they reliably collide with
// pattern-based detectors like the Facebook/Twitter token regexes and with
// the entropy scanner. They're never a live credential, so the base64
// payload is stripped before scanning (keeping the "data:...;base64," lead-in
// so a stripped blob is still visible in a diff, and staying on one line so
// line numbers of anything else in the file are unaffected).
const DATA_URI_BASE64_RE =
  /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

function stripDataUriBlobs(text: string): string {
  return text.replace(DATA_URI_BASE64_RE, (match) =>
    match.slice(0, match.indexOf(',') + 1),
  );
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

// The GCP pattern only anchors on the "type": "service_account" marker
// (a flat regex can't match a whole, possibly-nested, possibly-huge JSON
// object) - but live-testing a GCP key needs the actual private_key and
// client_email fields, not just proof the marker is present. This finds
// the enclosing {...} around the marker and returns it as the finding's
// real secretValue when it parses as valid JSON with the fields a service
// account key actually has; otherwise the caller falls back to the bare
// marker, same as before this existed. Bounded to a window around the
// marker (real service-account key files are a few KB) so this can't
// turn into an unbounded scan of a huge diff.
const GCP_JSON_SEARCH_WINDOW = 20_000;

interface IGcpJsonSpan {
  readonly json: string;
  readonly start: number;
  readonly end: number;
}

// Commit-diff text (see run-scan-job.use-case.ts's scanText(diffText) call)
// is a unified diff: every added line is prefixed with '+' (context lines
// with ' ', removed with '-'), so a JSON object spanning multiple diff
// lines fails JSON.parse as-is even though it's a genuine key. The
// candidate string starts exactly at the opening '{', so that '{' itself
// already had its own leading diff-marker char sliced away - only lines
// after the first can still carry one. Tried only as a fallback after the
// raw candidate fails to parse, so a real, non-diff JSON file (which
// parses fine as-is) is never touched by this; a plain multi-line JSON
// file whose indentation happens to start with a space still parses fine
// with one leading space stripped, so this fallback can't break that case.
function stripDiffLinePrefixes(candidate: string): string {
  return candidate
    .split('\n')
    .map((line, i) => {
      if (i === 0 || line.length === 0) return line;
      return line[0] === '+' || line[0] === '-' || line[0] === ' '
        ? line.slice(1)
        : line;
    })
    .join('\n');
}

function parseGcpKeyJson(candidate: string): Record<string, unknown> | null {
  for (const text of [candidate, stripDiffLinePrefixes(candidate)]) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function extractGcpServiceAccountJson(
  text: string,
  markerIndex: number,
): IGcpJsonSpan | null {
  const searchStart = Math.max(0, markerIndex - GCP_JSON_SEARCH_WINDOW);
  const searchEnd = Math.min(text.length, markerIndex + GCP_JSON_SEARCH_WINDOW);

  let openBrace = -1;
  for (let i = markerIndex; i >= searchStart; i -= 1) {
    if (text[i] === '{') {
      openBrace = i;
      break;
    }
  }
  if (openBrace === -1) {
    return null;
  }

  let depth = 0;
  let closeBrace = -1;
  let inString = false;
  let escaped = false;
  for (let i = openBrace; i < searchEnd; i += 1) {
    if (inString) {
      if (escaped) escaped = false;
      else if (text[i] === '\\') escaped = true;
      else if (text[i] === '"') inString = false;
      continue;
    }
    if (text[i] === '"') {
      inString = true;
      continue;
    }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        closeBrace = i;
        break;
      }
    }
  }
  if (closeBrace === -1) {
    return null;
  }

  const candidate = text.slice(openBrace, closeBrace + 1);
  const parsed = parseGcpKeyJson(candidate);
  const hasRequiredFields =
    typeof parsed?.private_key === 'string' &&
    typeof parsed?.client_email === 'string';
  if (!hasRequiredFields) {
    return null;
  }
  // Re-serialize from the parsed object rather than keeping whichever raw
  // candidate matched, so a diff-prefixed match's stored secretValue is
  // clean JSON (JSON.parse-able as-is by the live-key-validator adapter),
  // not literal '+'-prefixed lines.
  return {
    json: JSON.stringify(parsed),
    start: openBrace,
    end: closeBrace + 1,
  };
}

export function scanText(
  rawText: string,
  secretTypes?: readonly ESecretType[],
): IFinding[] {
  const text = stripMimeBase64Blocks(stripDataUriBlobs(rawText));
  const lineOffsets = buildLineOffsets(text);
  const findings: IFinding[] = [];
  const matchedSpans: Array<[number, number]> = [];

  for (const { secretType, pattern, requiredMarker } of PATTERNS) {
    if (secretTypes && !secretTypes.includes(secretType)) continue;
    if (requiredMarker instanceof RegExp) requiredMarker.lastIndex = 0;
    if (
      (typeof requiredMarker === 'string' && !text.includes(requiredMarker)) ||
      (requiredMarker instanceof RegExp && !requiredMarker.test(text))
    ) {
      continue;
    }
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      let value = match[0];
      let spanEnd = start + value.length;
      let lineStart = start;
      if (secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY) {
        const jsonSpan = extractGcpServiceAccountJson(text, start);
        if (jsonSpan) {
          value = jsonSpan.json;
          spanEnd = jsonSpan.end;
          lineStart = jsonSpan.start;
        }
      }
      matchedSpans.push([start, spanEnd]);
      if (isPlaceholder(secretType, value, null)) {
        continue;
      }
      findings.push({
        secretType,
        secretValue: value,
        lineNumber: lineNumberAt(lineOffsets, lineStart),
        context: null,
      });
    }
  }

  if (secretTypes && !secretTypes.includes(ESecretType.GENERIC_HIGH_ENTROPY))
    return findings;

  // Candidates arrive in text order. Sweep sorted intervals once instead of
  // searching every previous pattern match for every entropy candidate.
  matchedSpans.sort((a, b) => a[0] - b[0]);
  let spanIndex = 0;
  let coveredUntil = -1;
  for (const { token, index: start } of findHighEntropyTokens(text)) {
    while (
      spanIndex < matchedSpans.length &&
      matchedSpans[spanIndex][0] <= start
    ) {
      coveredUntil = Math.max(coveredUntil, matchedSpans[spanIndex++][1]);
    }
    const overlapsPatternMatch = start < coveredUntil;
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
