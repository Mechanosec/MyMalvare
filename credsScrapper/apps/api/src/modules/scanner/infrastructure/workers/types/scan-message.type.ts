import { IScanJobEvent } from '../../../application/use-cases/run-scan-job.use-case';

export type TScanMessage =
  { type: 'events'; events: IScanJobEvent[] } | { type: 'complete' };
