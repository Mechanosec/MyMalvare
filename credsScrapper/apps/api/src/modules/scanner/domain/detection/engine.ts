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
      findings.push({
        secretType,
        secretValue: value,
        lineNumber: lineNumberAt(text, start),
        context: null,
      });
      matchedSpans.push([start, start + value.length]);
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
    findings.push({
      secretType: ESecretType.GENERIC_HIGH_ENTROPY,
      secretValue: token,
      lineNumber: lineNumberAt(text, start),
      context: extractContext(text, start),
    });
  }

  return findings;
}
