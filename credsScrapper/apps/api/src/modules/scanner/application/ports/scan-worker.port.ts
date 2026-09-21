import { IRepoRef } from '../../domain/types/repo-ref.type';
import { IScanResumeOptions } from '../types/scan-checkpoint.type';
import {
  IScanJobEvent,
  TScanJobResult,
} from '../use-cases/run-scan-job.use-case';

// The CPU-heavy part of a scan (clone + diff parsing + secret detection)
// runs off the main thread behind this port, so ScanRepositoryUseCase
// never blocks the event loop regardless of repo size. See
// infrastructure/workers/piscina-scan-worker.adapter.ts.
export abstract class ScanWorkerPort {
  abstract run(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => void,
    resume?: IScanResumeOptions,
  ): Promise<TScanJobResult>;
}
