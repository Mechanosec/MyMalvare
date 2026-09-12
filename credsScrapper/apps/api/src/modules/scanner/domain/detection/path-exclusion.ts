// Test/spec/e2e/fixture files are the single noisiest source of false
// positives: fixtures intentionally embed fabricated "test key" secrets,
// and unit tests hardcode dummy tokens as inputs. None of these are a
// live credential, so they're excluded from scanning entirely rather
// than relying on isPlaceholder's value-based heuristic to catch them.
const EXCLUDED_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)(tests?|__tests__|specs?|e2e|fixtures?|__fixtures__|__mocks__|testdata)(\/|$)/i,
  /\.(test|spec|e2e)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /(^|\/)[^/]+_test\.(go|py)$/i,
];

export function isExcludedPath(filePath: string): boolean {
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}
