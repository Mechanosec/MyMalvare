interface ISortableHeaderProps<TKey extends string> {
  readonly label: string;
  readonly sortKey: TKey;
  readonly activeKey: TKey | null;
  readonly direction: 'asc' | 'desc';
  readonly onSort: (key: TKey) => void;
}

export function SortableHeader<TKey extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: ISortableHeaderProps<TKey>) {
  const active = sortKey === activeKey;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 hover:text-text ${active ? 'text-text' : ''}`}
      >
        {label}
        <span className="w-3 text-accent">{active ? (direction === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );
}
