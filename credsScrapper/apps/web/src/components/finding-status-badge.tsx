import { EFindingStatus } from '../lib/constant/finding-status.constant';

const TONE_BY_STATUS: Record<EFindingStatus, string> = {
  [EFindingStatus.VALID]: 'text-critical border-critical/50 bg-critical/10',
  [EFindingStatus.INVALID]: 'text-accent border-accent-dim bg-accent/10',
  [EFindingStatus.FAILED]: 'text-warning border-warning/50 bg-warning/10',
  [EFindingStatus.UNKNOWN]: 'text-text-dim border-line bg-surface-2',
};

interface IFindingStatusBadgeProps {
  readonly status: EFindingStatus;
}

// A "valid" leaked key is the worst outcome (still live, still a real
// exposure) - critical tone, same as SecretTypeBadge's confident-match
// tone. "Invalid" (confirmed dead) gets the reassuring accent tone.
export function FindingStatusBadge({ status }: IFindingStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_BY_STATUS[status]}`}
    >
      {status}
    </span>
  );
}
