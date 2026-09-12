import { Injectable } from '@nestjs/common';
import { GithubRepoLookupPort } from '../../application/ports/github-repo-lookup.port';

const TIMEOUT_MS = 5000;

@Injectable()
export class GithubApiRepoLookupAdapter extends GithubRepoLookupPort {
  async resolveRepoId(owner: string, name: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: { 'User-Agent': 'credsScrapper' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
      return typeof id === 'number' ? id : null;
    } catch {
      return null;
    }
  }
}
