import { EScanStatus } from '../lib/constant/scan-status.constant';

const TONE_BY_STATUS: Record<EScanStatus, string> = {
  [EScanStatus.DONE]: 'text-accent border-accent-dim bg-accent/10',
  [EScanStatus.FAILED]: 'text-critical border-critical/50 bg-critical/10',
  [EScanStatus.IN_PROGRESS]: 'text-warning border-warning/50 bg-warning/10',
  [EScanStatus.PENDING]: 'text-text-dim border-line bg-surface-2',
  [EScanStatus.CANCELLED]: 'text-text-dim border-line bg-surface-2',
};

interface IStatusBadgeProps {
  readonly status: EScanStatus;
}

export function StatusBadge({ status }: IStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_BY_STATUS[status]}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
