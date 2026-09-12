import { LoginUserUseCase } from '../../../../../src/modules/auth/application/use-cases/login-user.use-case';
import { UserRepositoryPort } from '../../../../../src/modules/auth/application/ports/user-repository.port';
import { PasswordHasherPort } from '../../../../../src/modules/auth/application/ports/password-hasher.port';
import { TokenPort } from '../../../../../src/modules/identity/application/ports/token.port';
import { EUserRole } from '../../../../../src/modules/identity/domain/constant/user-role.constant';

describe('LoginUserUseCase', () => {
  const existingUser = { id: 1, email: 'a@b.com', passwordHash: 'hashed', role: EUserRole.USER, createdAt: new Date() };

  it('returns a token when the password matches', async () => {
    const users = { findByEmail: jest.fn().mockResolvedValue(existingUser), createUser: jest.fn(), findById: jest.fn() } as unknown as UserRepositoryPort;
    const hasher = { compare: jest.fn().mockResolvedValue(true), hash: jest.fn() } as unknown as PasswordHasherPort;
    const token = { sign: jest.fn().mockReturnValue('signed-token'), verify: jest.fn() } as unknown as TokenPort;
    const useCase = new LoginUserUseCase(users, hasher, token);

    const result = await useCase.execute('a@b.com', 'plain-password');

    expect(hasher.compare).toHaveBeenCalledWith('plain-password', 'hashed');
    expect(result).toEqual({ token: 'signed-token', user: { id: 1, email: 'a@b.com', role: EUserRole.USER } });
  });

  it('returns null when the user does not exist', async () => {
    const users = { findByEmail: jest.fn().mockResolvedValue(null), createUser: jest.fn(), findById: jest.fn() } as unknown as UserRepositoryPort;
    const hasher = { compare: jest.fn(), hash: jest.fn() } as unknown as PasswordHasherPort;
    const token = { sign: jest.fn(), verify: jest.fn() } as unknown as TokenPort;
    const useCase = new LoginUserUseCase(users, hasher, token);

    expect(await useCase.execute('nobody@b.com', 'x')).toBeNull();
  });

  it('returns null when the password does not match', async () => {
    const users = { findByEmail: jest.fn().mockResolvedValue(existingUser), createUser: jest.fn(), findById: jest.fn() } as unknown as UserRepositoryPort;
    const hasher = { compare: jest.fn().mockResolvedValue(false), hash: jest.fn() } as unknown as PasswordHasherPort;
    const token = { sign: jest.fn(), verify: jest.fn() } as unknown as TokenPort;
    const useCase = new LoginUserUseCase(users, hasher, token);

    expect(await useCase.execute('a@b.com', 'wrong')).toBeNull();
  });
});
