type TPageToken = number | 'ellipsis';

// O(delta) window around the current page, not O(total) - with tens of
// thousands of pages, building the full 1..total range just to keep two
// entries of it would be wasted work on every render.
function getPageTokens(current: number, total: number, delta = 2): TPageToken[] {
  const start = Math.max(2, current - delta);
  const end = Math.min(total - 1, current + delta);
  const tokens: TPageToken[] = [1];

  if (start > 2) tokens.push('ellipsis');
  for (let i = start; i <= end; i += 1) tokens.push(i);
  if (end < total - 1) tokens.push('ellipsis');
  if (total > 1) tokens.push(total);

  return tokens;
}

interface IPaginationProps {
  /** 0-indexed, to match the API's offset-based paging. */
  readonly page: number;
  readonly pageCount: number;
  readonly onChange: (page: number) => void;
}

export function Pagination({ page, pageCount, onChange }: IPaginationProps) {
  const current = page + 1;

  return (
    <div className="flex items-center justify-end gap-1 text-sm">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        className="border border-line px-3 py-1.5 text-text-dim hover:text-text disabled:opacity-30"
      >
        Previous
      </button>

      {getPageTokens(current, pageCount).map((token, index) =>
        token === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="px-2 text-text-dim">
            …
          </span>
        ) : (
          <button
            key={token}
            type="button"
            onClick={() => onChange(token - 1)}
            aria-current={token === current ? 'page' : undefined}
            className={`min-w-8 border px-2 py-1.5 font-mono text-xs ${
              token === current
                ? 'border-accent text-accent'
                : 'border-line text-text-dim hover:text-text'
            }`}
          >
            {token}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onChange(Math.min(pageCount - 1, page + 1))}
        disabled={page + 1 >= pageCount}
        className="border border-line px-3 py-1.5 text-text-dim hover:text-text disabled:opacity-30"
      >
        Next
      </button>
    </div>
  );
}
