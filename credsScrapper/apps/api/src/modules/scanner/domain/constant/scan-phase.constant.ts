export enum EScanPhase {
  HEAD = 'head',
  HISTORY = 'history',
}

export enum EScanPhaseStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  DONE = 'done',
  INCOMPLETE = 'incomplete',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}
