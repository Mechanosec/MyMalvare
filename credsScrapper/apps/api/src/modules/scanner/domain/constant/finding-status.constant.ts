// A finding starts unknown. Opt-in live testing can establish a verdict
// or fail to establish one; manual status changes are separate.
export enum EFindingStatus {
  UNKNOWN = 'unknown',
  VALID = 'valid',
  INVALID = 'invalid',
  FAILED = 'failed',
}
