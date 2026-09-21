import { GetMyFindingsUseCase } from '../../../../../src/modules/auth/application/use-cases/get-my-findings.use-case';
import { RepoAuthorizationRepositoryPort } from '../../../../../src/modules/auth/application/ports/repo-authorization-repository.port';
import { ERepoAuthorizationStatus } from '../../../../../src/modules/auth/domain/constant/repo-authorization-status.constant';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';

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

describe('GetMyFindingsUseCase', () => {
  it('returns an empty page when the user has no approved repos', async () => {
    const authorizations = {
      listByUser: jest
        .fn()
        .mockResolvedValue([
          makeApproval({ status: ERepoAuthorizationStatus.PENDING }),
        ]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest.fn(),
      listFindings: jest.fn(),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyFindingsUseCase(authorizations, state);

    const result = await useCase.execute(1, {});

    expect(result).toEqual({ items: [], total: 0 });
    expect(state.findFindingsRepoOptionsByOwnerName).not.toHaveBeenCalled();
  });

  it('returns an empty page when the approved repos have no findings', async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest.fn().mockResolvedValue([]),
      listFindings: jest.fn(),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyFindingsUseCase(authorizations, state);

    const result = await useCase.execute(1, {});

    expect(result).toEqual({ items: [], total: 0 });
    expect(state.listFindings).not.toHaveBeenCalled();
  });

  it("forces repoIds to the caller's own approved repos, ignoring anything else in the filter", async () => {
    const authorizations = {
      listByUser: jest.fn().mockResolvedValue([makeApproval()]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest
        .fn()
        .mockResolvedValue([
          { repoId: 42, owner: 'acme', name: 'widgets', count: 3 },
        ]),
      listFindings: jest.fn().mockResolvedValue({ items: [], total: 3 }),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyFindingsUseCase(authorizations, state);

    await useCase.execute(1, { search: 'aws', limit: 10 });

    expect(state.findFindingsRepoOptionsByOwnerName).toHaveBeenCalledWith([
      { owner: 'acme', name: 'widgets' },
    ]);
    expect(state.listFindings).toHaveBeenCalledWith({
      search: 'aws',
      limit: 10,
      repoIds: [42],
    });
  });

  it('paginates one requested approved repository without exposing another repository', async () => {
    const authorizations = {
      listByUser: jest
        .fn()
        .mockResolvedValue([makeApproval(), makeApproval({ name: 'other' })]),
    } as unknown as RepoAuthorizationRepositoryPort;
    const state = {
      findFindingsRepoOptionsByOwnerName: jest.fn().mockResolvedValue([
        { repoId: 42, owner: 'acme', name: 'widgets' },
        { repoId: 43, owner: 'acme', name: 'other' },
      ]),
      listFindings: jest.fn().mockResolvedValue({ items: [], total: 1500 }),
    } as unknown as StateRepositoryPort;
    const useCase = new GetMyFindingsUseCase(authorizations, state);

    expect(
      await useCase.execute(1, { repoIds: [42], limit: 50, offset: 1000 }),
    ).toEqual({ items: [], total: 1500 });
    expect(state.listFindings).toHaveBeenCalledWith({
      repoIds: [42],
      limit: 50,
      offset: 1000,
    });

    expect(await useCase.execute(1, { repoIds: [99], limit: 50 })).toEqual({
      items: [],
      total: 0,
    });
    expect(state.listFindings).toHaveBeenCalledTimes(1);
  });
});
