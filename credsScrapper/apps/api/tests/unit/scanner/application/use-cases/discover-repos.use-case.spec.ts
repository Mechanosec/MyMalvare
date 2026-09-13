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

  it('stops at the next 2000-event checkpoint once shouldStop reports true, not processing the rest of the feed', async () => {
    const state = new FakeStateRepository();
    // The stop check only runs at the same cadence as the progress report
    // (every 2000 events) - a feed needs to actually reach that checkpoint
    // for shouldStop to ever be consulted.
    const events = Array.from({ length: 4000 }, (_, i) => pushEvent(i + 1, `octocat/repo${i + 1}`));
    const feed = new FakeFeed(events);
    const useCase = new DiscoverReposUseCase(feed, state, new FakeLogger());
    const messages: string[] = [];

    const added = await useCase.execute(
      new Date(),
      (message) => messages.push(message),
      async () => true,
    );

    expect(added).toBe(2000);
    expect(messages[messages.length - 1]).toBe(
      'discovery: stopped by request, 2000 push events processed, 2000 new candidates added',
    );
  });
});
