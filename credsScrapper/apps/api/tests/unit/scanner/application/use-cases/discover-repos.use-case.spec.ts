import { DiscoveryFeedPort } from '../../../../../src/modules/scanner/application/ports/discovery-feed.port';
import { DiscoverReposUseCase } from '../../../../../src/modules/scanner/application/use-cases/discover-repos.use-case';
import { FakeLogger } from '../../fakes/fake-logger';
import { FakeStateRepository } from '../../fakes/fake-state-repository';

class FakeFeed extends DiscoveryFeedPort {
  constructor(private readonly lines: string[]) {
    super();
  }
  async *fetchHourLines(): AsyncIterable<string> {
    for (const line of this.lines) {
      yield line;
    }
  }
}

function pushEvent(repoId: number, fullName: string): string {
  return JSON.stringify({ type: 'PushEvent', repo: { id: repoId, name: fullName } });
}

describe('DiscoverReposUseCase', () => {
  it('adds new candidates and skips already-known ones', async () => {
    const state = new FakeStateRepository();
    await state.addCandidate(1, 'octocat', 'hello-world');
    const feed = new FakeFeed([pushEvent(1, 'octocat/hello-world'), pushEvent(2, 'octocat/other')]);
    const useCase = new DiscoverReposUseCase(feed, state, new FakeLogger());

    const added = await useCase.execute(new Date());

    expect(added).toBe(1);
    expect(await state.isKnown(2)).toBe(true);
  });

  it('reports start and finish messages through onProgress', async () => {
    const state = new FakeStateRepository();
    const feed = new FakeFeed([pushEvent(1, 'octocat/hello-world')]);
    const useCase = new DiscoverReposUseCase(feed, state, new FakeLogger());
    const messages: string[] = [];

    await useCase.execute(new Date(), (message) => messages.push(message));

    expect(messages[0]).toBe('discovery: starting to read events');
    expect(messages[messages.length - 1]).toBe(
      'discovery: finished, 1 push events processed, 1 new candidates added',
    );
  });
});
