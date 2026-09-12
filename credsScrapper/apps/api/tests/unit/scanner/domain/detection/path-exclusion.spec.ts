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
  ])('excludes %s', (filePath) => {
    expect(isExcludedPath(filePath)).toBe(true);
  });

  it.each([
    'src/utils/secrets.py',
    'ui/litellm-dashboard/src/utils/config.ts',
    'src/protest/handler.ts',
    'config/attestation.py',
  ])('does not exclude %s', (filePath) => {
    expect(isExcludedPath(filePath)).toBe(false);
  });
});
