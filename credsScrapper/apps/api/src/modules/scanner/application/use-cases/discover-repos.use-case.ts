import { parsePushEvents } from '../../domain/discovery/parse-push-events';
import { DiscoveryFeedPort } from '../ports/discovery-feed.port';
import { LoggerPort } from '../ports/logger.port';
import { StateRepositoryPort } from '../ports/state-repository.port';

// Ported from credsScrapper/app/discovery/worker.py's run_discovery_once.
// Plain class, constructed with `new` (in tests, with hand-written fake
// ports) - no NestJS decorators, no framework dependency in this layer.
export class DiscoverReposUseCase {
  constructor(
    private readonly feed: DiscoveryFeedPort,
    private readonly state: StateRepositoryPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    date: Date = new Date(Date.now() - 60 * 60 * 1000),
    onProgress?: (message: string) => void,
  ): Promise<number> {
    const report = (message: string) => {
      this.logger.log(message);
      onProgress?.(message);
    };

    report('discovery: starting to read events');
    let seen = 0;
    let added = 0;
    for await (const ref of parsePushEvents(this.feed.fetchHourLines(date))) {
      seen += 1;
      if (await this.state.addCandidate(ref.repoId, ref.owner, ref.name)) {
        added += 1;
      }
      if (seen % 2000 === 0) {
        report(`discovery: processed ${seen} push events, ${added} new candidates so far`);
      }
    }
    report(`discovery: finished, ${seen} push events processed, ${added} new candidates added`);
    return added;
  }
}
