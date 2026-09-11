import { parsePushEvents } from '../../../../../src/modules/scanner/domain/discovery/parse-push-events';

function pushEvent(repoId: number, fullName: string): string {
  return JSON.stringify({ type: 'PushEvent', repo: { id: repoId, name: fullName } });
}

async function* linesOf(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) {
    yield line;
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe('parsePushEvents', () => {
  it('extracts owner and name', async () => {
    const result = await collect(parsePushEvents(linesOf([pushEvent(1, 'octocat/hello-world')])));
    expect(result).toEqual([{ repoId: 1, owner: 'octocat', name: 'hello-world' }]);
  });

  it('skips non-PushEvent events', async () => {
    const line = JSON.stringify({ type: 'WatchEvent', repo: { id: 2, name: 'a/b' } });
    const result = await collect(parsePushEvents(linesOf([line])));
    expect(result).toEqual([]);
  });

  it('skips malformed JSON', async () => {
    const result = await collect(
      parsePushEvents(linesOf(['not json', pushEvent(3, 'octocat/other')])),
    );
    expect(result).toEqual([{ repoId: 3, owner: 'octocat', name: 'other' }]);
  });

  it('handles multiple lines', async () => {
    const result = await collect(
      parsePushEvents(linesOf([pushEvent(1, 'a/b'), pushEvent(2, 'c/d')])),
    );
    expect(result).toEqual([
      { repoId: 1, owner: 'a', name: 'b' },
      { repoId: 2, owner: 'c', name: 'd' },
    ]);
  });
});
