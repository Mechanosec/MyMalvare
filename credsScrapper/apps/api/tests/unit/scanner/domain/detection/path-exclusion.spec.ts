import { isExcludedPath } from '../../../../../src/modules/scanner/domain/detection/path-exclusion';

describe('isExcludedPath', () => {
  it.each([
    'tests/test_litellm/test_secrets.py',
    'tests/test_litellm/proxy/test_client.py',
    'src/__tests__/auth.test.ts',
    'src/utils/config.spec.ts',
    'e2e/login.e2e.ts',
    'fixtures/aws-key.json',
    '__fixtures__/response.json',
    '__mocks__/prisma.ts',
    'testdata/sample.txt',
    'internal/auth_test.go',
    'spec/models/user_spec.py',
    'litellm/proxy/_experimental/out/_next/static/chunks/03_s-zve24zyk.js',
    'ui/dist/assets/index-5v0iwkLz.js',
    'app/build/main.js',
    '.next/static/chunks/main.js',
    'vendor/github.com/foo/bar.go',
    'node_modules/lodash/index.js',
    'src/app.min.js',
    'litellm/proxy/swagger/swagger-ui-bundle.js',
    'litellm/proxy/swagger/swagger-ui.css',
    'docker/ci-cd-tools/package-lock.json',
    'yarn.lock',
    'apps/api/pnpm-lock.yaml',
    'Gemfile.lock',
    'Cargo.lock',
    'poetry.lock',
    'go.sum',
  ])('excludes %s', (filePath) => {
    expect(isExcludedPath(filePath)).toBe(true);
  });

  it.each([
    'src/utils/secrets.py',
    'ui/litellm-dashboard/src/utils/config.ts',
    'src/protest/handler.ts',
    'config/attestation.py',
    'src/about/team.ts',
    'src/shoutout/handler.ts',
  ])('does not exclude %s', (filePath) => {
    expect(isExcludedPath(filePath)).toBe(false);
  });
});
