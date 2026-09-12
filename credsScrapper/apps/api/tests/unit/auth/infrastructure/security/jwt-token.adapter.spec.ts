import { JwtTokenAdapter } from '../../../../../src/modules/auth/infrastructure/security/jwt-token.adapter';
import { EUserRole } from '../../../../../src/modules/auth/domain/constant/user-role.constant';

const TEST_SECRET = 'a-fixed-32-plus-char-test-secret-value';

describe('JwtTokenAdapter', () => {
  const payload = { id: 1, email: 'a@b.com', role: EUserRole.USER };

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('signs and verifies a valid token round-trip', () => {
    const adapter = new JwtTokenAdapter();
    const token = adapter.sign(payload);
    expect(adapter.verify(token)).toEqual(payload);
  });

  it('returns null for a malformed token', () => {
    const adapter = new JwtTokenAdapter();
    expect(adapter.verify('not-a-real-token')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    process.env.JWT_SECRET = 'a-different-secret-for-this-test-only';
    const otherAdapter = new JwtTokenAdapter();
    const token = otherAdapter.sign(payload);
    process.env.JWT_SECRET = TEST_SECRET;
    expect(new JwtTokenAdapter().verify(token)).toBeNull();
  });
});
