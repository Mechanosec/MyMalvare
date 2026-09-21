export interface IAwsCredentials {
  readonly access: string;
  readonly private: string;
  readonly sessionToken?: string;
}

export interface IAwsCredentialCandidate extends IAwsCredentials {
  readonly start: number;
  readonly end: number;
}
