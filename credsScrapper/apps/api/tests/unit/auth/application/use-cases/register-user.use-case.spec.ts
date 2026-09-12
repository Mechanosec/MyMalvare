import { RegisterUserUseCase } from '../../../../../src/modules/auth/application/use-cases/register-user.use-case';
import { UserRepositoryPort } from '../../../../../src/modules/auth/application/ports/user-repository.port';
import { PasswordHasherPort } from '../../../../../src/modules/auth/application/ports/password-hasher.port';
import { TokenPort } from '../../../../../src/modules/identity/application/ports/token.port';
import { EUserRole } from '../../../../../src/modules/identity/domain/constant/user-role.constant';

describe('RegisterUserUseCase', () => {
  it('hashes the password, creates the user, and returns a signed token', async () => {
    const createdUser = { id: 1, email: 'a@b.com', passwordHash: 'hashed', role: EUserRole.USER, createdAt: new Date() };
    const users = {
      createUser: jest.fn().mockResolvedValue(createdUser),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    } as unknown as UserRepositoryPort;
    const hasher = { hash: jest.fn().mockResolvedValue('hashed'), compare: jest.fn() } as unknown as PasswordHasherPort;
    const token = { sign: jest.fn().mockReturnValue('signed-token'), verify: jest.fn() } as unknown as TokenPort;
    const useCase = new RegisterUserUseCase(users, hasher, token);

    const result = await useCase.execute('a@b.com', 'plain-password');

    expect(hasher.hash).toHaveBeenCalledWith('plain-password');
    expect(users.createUser).toHaveBeenCalledWith('a@b.com', 'hashed');
    expect(token.sign).toHaveBeenCalledWith({ id: 1, email: 'a@b.com', role: EUserRole.USER });
    expect(result).toEqual({ token: 'signed-token', user: { id: 1, email: 'a@b.com', role: EUserRole.USER } });
  });

  it('returns null when the email is already taken', async () => {
    const users = {
      createUser: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    } as unknown as UserRepositoryPort;
    const hasher = { hash: jest.fn().mockResolvedValue('hashed'), compare: jest.fn() } as unknown as PasswordHasherPort;
    const token = { sign: jest.fn(), verify: jest.fn() } as unknown as TokenPort;
    const useCase = new RegisterUserUseCase(users, hasher, token);

    expect(await useCase.execute('taken@b.com', 'plain-password')).toBeNull();
  });

  it('throws for an invalid email or a too-short password', async () => {
    const users = { createUser: jest.fn(), findByEmail: jest.fn(), findById: jest.fn() } as unknown as UserRepositoryPort;
    const hasher = { hash: jest.fn(), compare: jest.fn() } as unknown as PasswordHasherPort;
    const token = { sign: jest.fn(), verify: jest.fn() } as unknown as TokenPort;
    const useCase = new RegisterUserUseCase(users, hasher, token);

    await expect(useCase.execute('not-an-email', 'longenough')).rejects.toThrow();
    await expect(useCase.execute('a@b.com', 'short')).rejects.toThrow();
    expect(users.createUser).not.toHaveBeenCalled();
  });
});
