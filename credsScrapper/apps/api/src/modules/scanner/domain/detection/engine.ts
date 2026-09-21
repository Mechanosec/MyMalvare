import { createPrivateKey } from 'node:crypto';
import { ESecretType } from '../constant/secret-type.constant';
import { IFinding } from '../types/finding.type';
import { findHighEntropyTokens } from './entropy';
import { PATTERNS } from './patterns';
import { pairAwsCredentials } from './aws-credentials';

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

// A complete GCP credential is validated structurally below. Its project
// name may legitimately contain placeholder words, so do not reject it here.
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
// replaced with the same number of newlines to preserve source positions.
const MIME_BASE64_BLOCK_RE = /(?:^[A-Za-z0-9+/]{40,}={0,2}[ \t]*\r?\n){4,}/gm;

function stripMimeBase64Blocks(text: string): string {
  return text.replace(MIME_BASE64_BLOCK_RE, (match) =>
    '\n'.repeat(match.split('\n').length - 1),
  );
}

// Notebook outputs often store image bytes as bare base64 JSON strings,
// including arrays of wrapped fragments. These are media data, not tokens.
// Replace only values under explicit media keys and preserve every offset.
function stripJsonMediaBlobs(text: string): string {
  const spans: Array<[number, number]> = [];
  const skipGap = (start: number): number => {
    let index = start;
    while (index < text.length) {
      if (/\s/.test(text[index])) index++;
      else if (
        (text[index] === '+' || text[index] === '-') &&
        (index === 0 || text[index - 1] === '\n')
      )
        index++;
      else break;
    }
    return index;
  };

  for (const field of text.matchAll(
    /"(?:image\/(?:png|jpeg|gif|webp)|application\/pdf)"\s*:/g,
  )) {
    let index = skipGap((field.index ?? 0) + field[0].length);
    const array = text[index] === '[';
    if (array) index = skipGap(index + 1);
    while (text[index] === '"') {
      const start = index + 1;
      const end = text.indexOf('"', start);
      if (
        end === -1 ||
        !/^[A-Za-z0-9+/]{32,}={0,2}$/.test(text.slice(start, end))
      )
        break;
      spans.push([start, end]);
      if (!array) break;
      index = skipGap(end + 1);
      if (text[index] !== ',') break;
      index = skipGap(index + 1);
    }
  }
  if (spans.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    parts.push(text.slice(cursor, start), ' '.repeat(end - start));
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

// The GCP pattern only anchors on the "type": "service_account" marker
// (a flat regex can't match a whole, possibly-nested, possibly-huge JSON
// object) - but live-testing a GCP key needs the actual private_key and
// client_email fields, not just proof the marker is present. This finds
// the enclosing {...} around the marker and returns it as the finding's
// real secretValue when it parses as valid JSON with the fields a service
// account key actually has; an incomplete marker is not a finding.
// Bounded to a window around the marker (real service-account key files are a few KB) so this can't
// turn into an unbounded scan of a huge diff.
const GCP_JSON_SEARCH_WINDOW = 20_000;

interface IGcpJsonSpan {
  readonly json: string | null;
  readonly start: number;
  readonly end: number;
}

// A pretty-printed JSON key in a diff has a marker on every line. Context
// lines belong to either version, but added and removed lines cannot be
// combined into one credential.
function stripDiffLinePrefixes(
  candidate: string,
  openingMarker: '+' | '-' | ' ',
): string | null {
  const lines = candidate.split('\n');
  const stripped = [lines[0]];
  let side: '+' | '-' | null = openingMarker === ' ' ? null : openingMarker;
  for (const line of lines.slice(1)) {
    const marker = line[0];
    if (
      (marker !== '+' && marker !== '-' && marker !== ' ') ||
      line.startsWith('+++') ||
      line.startsWith('---')
    )
      return null;
    if (marker === '+' || marker === '-') {
      if (side !== null && side !== marker) return null;
      side = marker;
    }
    stripped.push(line.slice(1));
  }
  return stripped.join('\n');
}

function parseGcpKeyJson(
  candidate: string,
  openingMarker: '+' | '-' | ' ' | null,
): Record<string, unknown> | null {
  const stripped = openingMarker
    ? stripDiffLinePrefixes(candidate, openingMarker)
    : null;
  for (const text of [candidate, stripped]) {
    if (text === null) continue;
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
  const prefix = text.slice(
    text.lastIndexOf('\n', openBrace - 1) + 1,
    openBrace,
  );
  const openingMarker = /^[+\- ]\s*$/.test(prefix)
    ? (prefix[0] as '+' | '-' | ' ')
    : null;
  const parsed = parseGcpKeyJson(candidate, openingMarker);
  const privateKey = parsed?.private_key;
  let validPrivateKey = false;
  if (
    typeof privateKey === 'string' &&
    /^-----BEGIN PRIVATE KEY-----\r?\n/.test(privateKey)
  ) {
    try {
      const key = createPrivateKey(privateKey);
      validPrivateKey =
        key.asymmetricKeyType === 'rsa' &&
        (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048;
    } catch {
      // A PEM-looking placeholder is not a credential.
    }
  }
  const hasRequiredFields =
    parsed?.type === 'service_account' &&
    typeof parsed.project_id === 'string' &&
    parsed.project_id.length > 0 &&
    typeof parsed.client_email === 'string' &&
    /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(parsed.client_email) &&
    validPrivateKey;
  if (!hasRequiredFields) {
    return { json: null, start: openBrace, end: closeBrace + 1 };
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

// SRI digests are public checksums. Only exclude a complete checksum inside
// an explicit integrity value, leaving neighboring tokens and specific
// detector matches untouched.
function addSriIntegritySpans(
  text: string,
  spans: Array<[number, number]>,
): void {
  const integrityValueRe =
    /(?:^|[\s<])integrity\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')|(?:"integrity"|'integrity')\s*:\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/g;
  const checksumRe =
    /(?:^|\s)(sha(256|384|512)-([A-Za-z0-9+/]+={0,2}))(?=\s|$)/g;

  for (const field of text.matchAll(integrityValueRe)) {
    if (field[1] !== undefined || field[2] !== undefined) {
      const tagStart = text.lastIndexOf('<', field.index);
      if (
        tagStart === -1 ||
        tagStart < text.lastIndexOf('>', field.index) ||
        !/[A-Za-z]/.test(text[tagStart + 1] ?? '')
      )
        continue;
    }
    const value = field[1] ?? field[2] ?? field[3] ?? field[4];
    const valueStart = (field.index ?? 0) + field[0].length - value.length - 1;
    for (const checksum of value.matchAll(checksumRe)) {
      const digest = checksum[3];
      const expectedBytes = Number(checksum[2]) / 8;
      if (digest.length !== Math.ceil(expectedBytes / 3) * 4) continue;
      const bytes = Buffer.from(digest, 'base64');
      if (bytes.length !== expectedBytes || bytes.toString('base64') !== digest)
        continue;
      const start =
        valueStart + (checksum.index ?? 0) + checksum[0].length - digest.length;
      spans.push([start, start + digest.length]);
    }
  }
}

export function scanText(
  rawText: string,
  secretTypes?: readonly ESecretType[],
): IFinding[] {
  const text = stripMimeBase64Blocks(
    stripJsonMediaBlobs(stripDataUriBlobs(rawText)),
  );
  const lineOffsets = buildLineOffsets(text);
  const isUnifiedDiff =
    /^--- .+$/m.test(text) &&
    /^\+\+\+ .+$/m.test(text) &&
    /^@@ .+@@/m.test(text);
  const findings: IFinding[] = [];
  const matchedSpans: Array<[number, number]> = [];
  const shouldPairAws =
    !secretTypes || secretTypes.includes(ESecretType.AWS_ACCESS_KEY_ID);
  const finish = (): IFinding[] => {
    const paired = shouldPairAws
      ? pairAwsCredentials(text, findings)
      : findings;
    return secretTypes
      ? paired.filter((finding) => secretTypes.includes(finding.secretType))
      : paired;
  };

  for (const { secretType, pattern, requiredMarker } of PATTERNS) {
    if (
      secretTypes &&
      !secretTypes.includes(secretType) &&
      !(shouldPairAws && secretType === ESecretType.AWS_SECRET_ACCESS_KEY)
    )
      continue;
    if (requiredMarker instanceof RegExp) requiredMarker.lastIndex = 0;
    if (
      (typeof requiredMarker === 'string' && !text.includes(requiredMarker)) ||
      (requiredMarker instanceof RegExp && !requiredMarker.test(text))
    ) {
      continue;
    }
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const precededByDiffMarker =
        isUnifiedDiff &&
        (text[start - 1] === '+' || text[start - 1] === '-') &&
        (start === 1 || text[start - 2] === '\n');
      if (
        (secretType === ESecretType.FACEBOOK_ACCESS_TOKEN ||
          secretType === ESecretType.TWITTER_BEARER_TOKEN) &&
        ((!precededByDiffMarker &&
          /[A-Za-z0-9+/_%-]/.test(text[start - 1] ?? '')) ||
          /[A-Za-z0-9+/_%=-]/.test(text[start + match[0].length] ?? ''))
      )
        continue;
      let value = match[0];
      let spanEnd = start + value.length;
      let lineStart = start;
      if (secretType === ESecretType.GCP_SERVICE_ACCOUNT_KEY) {
        const jsonSpan = extractGcpServiceAccountJson(text, start);
        if (!jsonSpan) continue;
        if (jsonSpan.json === null) {
          const candidate = text.slice(jsonSpan.start, jsonSpan.end);
          for (const privateKey of candidate.matchAll(
            /"private_key"\s*:\s*"((?:\\.|[^"\\])*)"/g,
          )) {
            const value = privateKey[1];
            const valueStart =
              jsonSpan.start +
              (privateKey.index ?? 0) +
              privateKey[0].length -
              value.length -
              1;
            matchedSpans.push([valueStart, valueStart + value.length]);
          }
          continue;
        }
        value = jsonSpan.json;
        spanEnd = jsonSpan.end;
        lineStart = jsonSpan.start;
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
    return finish();

  addSriIntegritySpans(text, matchedSpans);
  // Candidates arrive in text order. Sweep sorted intervals once instead of
  // searching every previous pattern match for every entropy candidate.
  matchedSpans.sort((a, b) => a[0] - b[0]);
  let spanIndex = 0;
  let coveredUntil = -1;
  for (const { token, index: start } of findHighEntropyTokens(text)) {
    while (
      spanIndex < matchedSpans.length &&
      matchedSpans[spanIndex][0] < start + token.length
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

  return finish();
}
