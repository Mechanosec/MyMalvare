export interface IScanCheckpoint {
  readonly headSha: string;
  readonly scannerVersion: string;
}

export interface IScanResumeOptions {
  readonly reuseGit: boolean;
  readonly checkpoint?: IScanCheckpoint;
  readonly scannerVersion: string;
}
