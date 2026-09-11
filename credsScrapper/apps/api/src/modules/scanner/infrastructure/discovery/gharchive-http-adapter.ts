import { Injectable } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { DiscoveryFeedPort } from '../../application/ports/discovery-feed.port';

// Ported from credsScrapper/app/discovery/gharchive.py's fetch_hour_lines.
export function buildGhArchiveUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = date.getUTCHours(); // no leading zero - matches Python's "%-H"
  return `https://data.gharchive.org/${year}-${month}-${day}-${hour}.json.gz`;
}

@Injectable()
export class GhArchiveHttpAdapter extends DiscoveryFeedPort {
  async *fetchHourLines(date: Date): AsyncIterable<string> {
    const url = buildGhArchiveUrl(date);
    // GH Archive's CDN returns 403 for the default fetch User-Agent, so a
    // browser-like one is required here (same fix as the Python version).
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) {
      throw new Error(`GH Archive fetch failed: ${response.status} ${response.statusText}`);
    }
    const compressed = Buffer.from(await response.arrayBuffer());
    const decompressed = gunzipSync(compressed).toString('utf8');
    for (const line of decompressed.split('\n')) {
      if (line.length > 0) {
        yield line;
      }
    }
  }
}
