import { buildQueries, buildSearchUrl } from './dorks.js';

// Uses Google Programmable Search (Custom Search JSON API) when
// GOOGLE_API_KEY + GOOGLE_CX are set: https://developers.google.com/custom-search/v1/overview
// Without them, just returns the search URLs to open manually (no scraping —
// scraping google.com directly breaks ToS and gets you captcha'd).
export async function search(values, { templates, apiKey = process.env.GOOGLE_API_KEY, cx = process.env.GOOGLE_CX } = {}) {
  const queries = buildQueries(values, templates);

  if (!apiKey || !cx) {
    return queries.map((query) => ({ query, url: buildSearchUrl(query) }));
  }

  const results = [];
  for (const query of queries) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);

    const res = await fetch(url);
    if (!res.ok) {
      results.push({ query, error: `${res.status} ${res.statusText}` });
      continue;
    }
    const data = await res.json();
    results.push({ query, items: (data.items ?? []).map((i) => ({ title: i.title, link: i.link, snippet: i.snippet })) });
  }
  return results;
}
