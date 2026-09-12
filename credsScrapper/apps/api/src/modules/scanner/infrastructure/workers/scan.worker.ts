import { MessagePort } from 'node:worker_threads';
import {
  RunScanJobUseCase,
  TScanJobResult,
} from '../../application/use-cases/run-scan-job.use-case';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitCliAdapter } from '../git/git-cli-adapter';

export interface IScanWorkerTaskData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
  readonly port: MessagePort;
}

// Piscina's task entry point - runs inside a worker thread, so it can't
// reach NestJS's DI container. GitCliAdapter is a plain class (its
// @Injectable() decorator is inert without Nest's container), so it's
// instantiated directly here instead.
export default async function runScanTask(
  data: IScanWorkerTaskData,
): Promise<TScanJobResult> {
  const useCase = new RunScanJobUseCase(new GitCliAdapter());
  return useCase.execute(
    data.repoRef,
    data.cloneSource,
    data.workdir,
    (event) => {
      data.port.postMessage(event);
    },
  );
}
