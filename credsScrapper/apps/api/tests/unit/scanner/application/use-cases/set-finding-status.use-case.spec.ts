import { SetFindingStatusUseCase } from '../../../../../src/modules/scanner/application/use-cases/set-finding-status.use-case';
import { StateRepositoryPort } from '../../../../../src/modules/scanner/application/ports/state-repository.port';
import { EFindingStatus } from '../../../../../src/modules/scanner/domain/constant/finding-status.constant';

describe('SetFindingStatusUseCase', () => {
  it('delegates to the state port', async () => {
    const state = { updateFindingStatus: jest.fn() } as unknown as StateRepositoryPort;
    const useCase = new SetFindingStatusUseCase(state);

    await useCase.execute(7, EFindingStatus.INVALID);

    expect(state.updateFindingStatus).toHaveBeenCalledWith(7, EFindingStatus.INVALID);
  });
});
