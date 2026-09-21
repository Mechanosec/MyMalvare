// Google dork templates. {q} is replaced with the value being searched.
export const DORK_TEMPLATES = [
  '"{q}"',
  'intext:"{q}"',
  'filetype:env "{q}"',
  'filetype:log "{q}"',
  'inurl:.git "{q}"',
  'site:github.com "{q}"',
  'site:pastebin.com "{q}"',
  'intitle:"index of" "{q}"',
];

export function buildQueries(values, templates = DORK_TEMPLATES) {
  return values.flatMap((v) => templates.map((t) => t.replaceAll('{q}', v)));
}

export function buildSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
