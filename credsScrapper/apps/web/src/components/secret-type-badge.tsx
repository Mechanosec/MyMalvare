import { ESecretType } from '../lib/constant/secret-type.constant';

function formatSecretType(secretType: ESecretType): string {
  return secretType.replace(/_/g, ' ');
}

interface ISecretTypeBadgeProps {
  readonly secretType: ESecretType;
}

// generic_high_entropy has no known service - flagged distinctly (warning
// tone) since it's an unconfirmed guess, unlike a matched service pattern
// (aws_access_key_id, etc.), which gets the confident/critical tone: a
// finding either way, but "we don't know what this is" is a different
// claim from "this is a Stripe key".
export function SecretTypeBadge({ secretType }: ISecretTypeBadgeProps) {
  const isUnidentified = secretType === ESecretType.GENERIC_HIGH_ENTROPY;
  const tone = isUnidentified
    ? 'text-warning border-warning/50 bg-warning/10'
    : 'text-critical border-critical/50 bg-critical/10';

  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-xs ${tone}`}
    >
      {formatSecretType(secretType)}
    </span>
  );
}
