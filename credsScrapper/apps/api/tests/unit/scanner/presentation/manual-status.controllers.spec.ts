import { BadRequestException } from '@nestjs/common';
import { RepoAuthorizationsController } from '../../../../src/modules/auth/presentation/repo-authorizations.controller';
import { EFindingStatus } from '../../../../src/modules/scanner/domain/constant/finding-status.constant';
import { ESecretType } from '../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FindingsController } from '../../../../src/modules/scanner/presentation/findings.controller';

function adminController(mark: jest.Mock): FindingsController {
  return new FindingsController(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    { execute: mark } as never,
    undefined as never,
    undefined as never,
  );
}

function userController(
  mark: jest.Mock,
  facets = jest.fn(),
): RepoAuthorizationsController {
  return new RepoAuthorizationsController(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    { execute: facets } as never,
    undefined as never,
    { execute: mark } as never,
    undefined as never,
    undefined as never,
  );
}

const request = { user: { id: 7 } } as never;

describe('manual finding status routes', () => {
  it('rejects manually marking a finding failed for an admin', async () => {
    const mark = jest.fn();
    const controller = adminController(mark);

    await expect(
      controller.updateStatus('11', EFindingStatus.FAILED),
    ).rejects.toThrow(BadRequestException);
    expect(mark).not.toHaveBeenCalled();
  });

  it('rejects manually marking a finding failed for an approved-repo user', async () => {
    const mark = jest.fn();
    const controller = userController(mark);

    await expect(
      controller.myFindingStatus(request, '11', EFindingStatus.FAILED),
    ).rejects.toThrow(BadRequestException);
    expect(mark).not.toHaveBeenCalled();
  });

  it.each([
    EFindingStatus.UNKNOWN,
    EFindingStatus.VALID,
    EFindingStatus.INVALID,
  ])('keeps %s available for manual admin and user changes', async (status) => {
    const adminMark = jest.fn().mockResolvedValue(undefined);
    const userMark = jest.fn().mockResolvedValue(true);

    await expect(
      adminController(adminMark).updateStatus('11', status),
    ).resolves.toEqual({ ok: true });
    await expect(
      userController(userMark).myFindingStatus(request, '11', status),
    ).resolves.toEqual({ ok: true });
  });

  it('still accepts failed as a testing facet filter', async () => {
    const result = { repositories: [], statuses: [], secretTypes: [] };
    const facets = jest.fn().mockResolvedValue(result);
    const controller = userController(jest.fn(), facets);

    await expect(
      controller.myTestingFacets(
        request,
        undefined,
        EFindingStatus.FAILED,
        undefined,
        ESecretType.GITHUB_PAT,
      ),
    ).resolves.toBe(result);
  });
});
