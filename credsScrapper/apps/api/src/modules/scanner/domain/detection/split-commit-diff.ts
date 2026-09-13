// `git log -p` diff text has no way to attribute a match's position back
// to a file except this header: `diff --git a/<old> b/<new>`, one per
// file changed in the commit. Splitting on it turns "found somewhere in
// this commit" into "found in this exact file" - the caller previously
// had no choice but to report every commit-history finding under the
// same opaque '<commit-diff>' placeholder.
const DIFF_FILE_HEADER_RE = /^diff --git a\/.+? b\/(.+)$/gm;

// Sentinel used when no `diff --git` header is present at all (a diff
// fed in some other, header-less shape) - same fallback behavior this
// code had before file-attribution existed.
export const UNKNOWN_DIFF_FILE = '<commit-diff>';
const DIFF_FILE_PREFIX = '<commit-diff>:';

export function makeDiffFileLabel(filePath: string): string {
  return `${DIFF_FILE_PREFIX}${filePath}`;
}

export function isDiffSourcedFile(filePath: string): boolean {
  return filePath === UNKNOWN_DIFF_FILE || filePath.startsWith(DIFF_FILE_PREFIX);
}

// null when filePath is the header-less UNKNOWN_DIFF_FILE sentinel (no
// real path known) or not diff-sourced at all.
export function extractDiffFilePath(filePath: string): string | null {
  return filePath.startsWith(DIFF_FILE_PREFIX) ? filePath.slice(DIFF_FILE_PREFIX.length) : null;
}

export interface IDiffFileSegment {
  readonly filePath: string;
  readonly text: string;
}

export function splitDiffByFile(diffText: string): IDiffFileSegment[] {
  const headers = [...diffText.matchAll(DIFF_FILE_HEADER_RE)];
  if (headers.length === 0) {
    return [{ filePath: UNKNOWN_DIFF_FILE, text: diffText }];
  }

  const segments: IDiffFileSegment[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const start = header.index! + header[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index! : diffText.length;
    segments.push({ filePath: makeDiffFileLabel(header[1]), text: diffText.slice(start, end) });
  }
  return segments;
}
