import { SetMyFindingStatusUseCase } from '../../../../../src/modules/auth/application/use-cases/set-my-finding-status.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';

function makeApproval(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    userId: 1,
    owner: 'acme',
    name: 'widgets',
    note: null,
    status: ERepoAuthorizationStatus.APPROVED,
    adminNote: null,
    createdAt: new Date(),
    decidedAt: new Date(),
    decidedByUserId: 2,
    ...overrides,
  };
}

describe('SetMyFindingStatusUseCase', () => {
  it('returns false when the user has no approved repos', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval({ status: ERepoAuthorizationStatus.PENDING })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest.fn(),
      listFindings: jest.fn(),
      updateFindingStatus: jest.fn(),
    } as unknown as StateRepositoryPort;
    const useCase = new SetMyFindingStatusUseCase(authorizations, state);

    const result = await useCase.execute(1, 10, EFindingStatus.VALID);

    expect(result).toBe(false);
    expect(state.updateFindingStatus).not.toHaveBeenCalled();
  });

  it("returns false when the finding isn't among the caller's own approved-repo findings", async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest
        .fn()
        .mockResolvedValue([{ repoId: 42, owner: 'acme', name: 'widgets', count: 1 }]),
      listFindings: jest.fn().mockResolvedValue({ items: [{ id: 99 }], total: 1 }),
      updateFindingStatus: jest.fn(),
    } as unknown as StateRepositoryPort;
    const useCase = new SetMyFindingStatusUseCase(authorizations, state);

    const result = await useCase.execute(1, 10, EFindingStatus.VALID);

    expect(result).toBe(false);
    expect(state.updateFindingStatus).not.toHaveBeenCalled();
  });

  it('updates the status and returns true when the finding is in one of the approved repos', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest
        .fn()
        .mockResolvedValue([{ repoId: 42, owner: 'acme', name: 'widgets', count: 1 }]),
      listFindings: jest.fn().mockResolvedValue({ items: [{ id: 10 }], total: 1 }),
      updateFindingStatus: jest.fn(),
    } as unknown as StateRepositoryPort;
    const useCase = new SetMyFindingStatusUseCase(authorizations, state);

    const result = await useCase.execute(1, 10, EFindingStatus.VALID);

    expect(result).toBe(true);
    expect(state.updateFindingStatus).toHaveBeenCalledWith(10, EFindingStatus.VALID);
  });
});
