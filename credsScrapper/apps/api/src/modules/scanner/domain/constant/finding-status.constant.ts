// Manually recorded verdict, not an automated probe result - see
// CLAUDE.md's "Detection is passive, always" rule. A finding starts
// unknown and only a human marks it valid/invalid via the Testing tab.
export enum EFindingStatus {
  UNKNOWN = 'unknown',
  VALID = 'valid',
  INVALID = 'invalid',
}
