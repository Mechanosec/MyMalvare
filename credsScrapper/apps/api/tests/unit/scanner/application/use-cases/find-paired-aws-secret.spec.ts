import { findPairedAwsSecretKey } from '../../../../../src/modules/scanner/application/use-cases/find-paired-aws-secret';
import { ESecretType } from '../../../../../src/modules/scanner/domain/constant/secret-type.constant';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

describe('findPairedAwsSecretKey', () => {
  it('returns the secret value of the AWS_SECRET_ACCESS_KEY finding in the same repo', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'AKIAFAKE', 1, null);
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_SECRET_ACCESS_KEY, 'a'.repeat(40), 2, null);

    const result = await findPairedAwsSecretKey(state, 1);

    expect(result).toBe('a'.repeat(40));
  });

  it('returns undefined when the repo has no AWS_SECRET_ACCESS_KEY finding', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(1, 'octocat', 'repo', 'a.py', 'sha', ESecretType.AWS_ACCESS_KEY_ID, 'AKIAFAKE', 1, null);

    const result = await findPairedAwsSecretKey(state, 1);

    expect(result).toBeUndefined();
  });

  it('does not pick up a secret key from a different repo', async () => {
    const state = new FakeStateRepository();
    await state.addFinding(2, 'someone', 'other', 'b.py', 'sha', ESecretType.AWS_SECRET_ACCESS_KEY, 'b'.repeat(40), 1, null);

    const result = await findPairedAwsSecretKey(state, 1);

    expect(result).toBeUndefined();
  });
});
