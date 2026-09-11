export abstract class DiscoveryFeedPort {
  abstract fetchHourLines(date: Date): AsyncIterable<string>;
}
