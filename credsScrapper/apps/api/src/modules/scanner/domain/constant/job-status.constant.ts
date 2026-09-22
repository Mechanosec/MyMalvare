export enum EJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
}

export enum EJobType {
  DISCOVER = 'discover',
  SCAN = 'scan',
}
