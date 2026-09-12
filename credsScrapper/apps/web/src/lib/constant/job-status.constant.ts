// Mirrored from apps/api's domain/constant/job-status.constant.ts.
export enum EJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
}

export enum EJobType {
  DISCOVER = 'discover',
  SCAN = 'scan',
}
