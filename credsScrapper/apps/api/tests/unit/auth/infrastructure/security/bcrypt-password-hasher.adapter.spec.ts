import { BcryptPasswordHasherAdapter } from '../../../../../src/modules/auth/infrastructure/security/bcrypt-password-hasher.adapter';

describe('BcryptPasswordHasherAdapter', () => {
  const hasher = new BcryptPasswordHasherAdapter();

  it('hashes a password and verifies it matches', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(await hasher.compare('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password against a real hash', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(await hasher.compare('wrong password', hash)).toBe(false);
  });
});
