import { IRepoRef } from '../types/repo-ref.type';

// Ported 1:1 from credsScrapper/app/discovery/gharchive.py's parse_push_events.
export async function* parsePushEvents(lines: AsyncIterable<string>): AsyncGenerator<IRepoRef> {
  for await (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event !== 'object' || event === null) {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type !== 'PushEvent') {
      continue;
    }
    const repo = record.repo as Record<string, unknown> | undefined;
    const fullName = repo?.name;
    const repoId = repo?.id;
    if (
      typeof fullName !== 'string' ||
      (typeof repoId !== 'number' && typeof repoId !== 'string') ||
      !fullName.includes('/')
    ) {
      continue;
    }
    const slashIndex = fullName.indexOf('/');
    const owner = fullName.slice(0, slashIndex);
    const name = fullName.slice(slashIndex + 1);
    yield { repoId: Number(repoId), owner, name };
  }
}
