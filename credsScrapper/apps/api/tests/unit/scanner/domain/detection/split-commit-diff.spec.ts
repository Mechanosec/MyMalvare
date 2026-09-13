import {
  extractDiffFilePath,
  isDiffSourcedFile,
  makeDiffFileLabel,
  splitDiffByFile,
  UNKNOWN_DIFF_FILE,
} from '../../../../../src/modules/scanner/domain/detection/split-commit-diff';

describe('splitDiffByFile', () => {
  it('falls back to a single UNKNOWN_DIFF_FILE segment when there is no diff --git header', () => {
    const diffText = "+AWS_KEY = 'AKIAABCDEFGH12345678'\n";

    const segments = splitDiffByFile(diffText);

    expect(segments).toEqual([{ filePath: UNKNOWN_DIFF_FILE, text: diffText }]);
  });

  it('splits a multi-file diff into one segment per file, labeled with its real path', () => {
    const diffText = [
      'diff --git a/config.py b/config.py',
      'index abc..def 100644',
      '--- a/config.py',
      '+++ b/config.py',
      '@@ -1,1 +1,2 @@',
      " existing = 'line'",
      "+AWS_KEY = 'AKIAABCDEFGH12345678'",
      'diff --git a/docker/ci-cd-tools/package-lock.json b/docker/ci-cd-tools/package-lock.json',
      'index 111..222 100644',
      '--- a/docker/ci-cd-tools/package-lock.json',
      '+++ b/docker/ci-cd-tools/package-lock.json',
      '@@ -1,1 +1,2 @@',
      '+{ "lockfileVersion": 2 }',
      '',
    ].join('\n');

    const segments = splitDiffByFile(diffText);

    expect(segments).toHaveLength(2);
    expect(segments[0].filePath).toBe(makeDiffFileLabel('config.py'));
    expect(segments[0].text).toContain('AWS_KEY');
    expect(segments[1].filePath).toBe(makeDiffFileLabel('docker/ci-cd-tools/package-lock.json'));
    expect(segments[1].text).toContain('lockfileVersion');
  });
});

describe('isDiffSourcedFile / extractDiffFilePath', () => {
  it('treats both the header-less sentinel and a labeled path as diff-sourced', () => {
    expect(isDiffSourcedFile(UNKNOWN_DIFF_FILE)).toBe(true);
    expect(isDiffSourcedFile(makeDiffFileLabel('src/config.py'))).toBe(true);
    expect(isDiffSourcedFile('src/config.py')).toBe(false);
  });

  it('extracts the real path only from a labeled diff-sourced filePath', () => {
    expect(extractDiffFilePath(makeDiffFileLabel('src/config.py'))).toBe('src/config.py');
    expect(extractDiffFilePath(UNKNOWN_DIFF_FILE)).toBeNull();
    expect(extractDiffFilePath('src/config.py')).toBeNull();
  });
});
