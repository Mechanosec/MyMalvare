interface IStatTileProps {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'default' | 'accent' | 'critical' | 'warning';
}

const VALUE_TONE: Record<NonNullable<IStatTileProps['tone']>, string> = {
  default: 'text-text',
  accent: 'text-accent',
  critical: 'text-critical',
  warning: 'text-warning',
};

export function StatTile({ label, value, tone = 'default' }: IStatTileProps) {
  return (
    <div className="border border-line bg-surface px-4 py-3">
      <p className="text-xs text-text-dim">{label}</p>
      <p className={`mt-1 font-mono text-2xl ${VALUE_TONE[tone]}`}>{value.toLocaleString()}</p>
    </div>
  );
}
