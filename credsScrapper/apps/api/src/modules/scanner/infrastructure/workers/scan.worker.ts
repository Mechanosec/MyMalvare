import { MessagePort } from 'node:worker_threads';
import { once } from 'node:events';
import {
  IScanJobEvent,
  RunScanJobUseCase,
  TScanJobResult,
} from '../../application/use-cases/run-scan-job.use-case';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { GitCliAdapter } from '../git/git-cli-adapter';
import { IScanResumeOptions } from '../../application/types/scan-checkpoint.type';

export interface IScanWorkerTaskData {
  readonly repoRef: IRepoRef;
  readonly cloneSource: string;
  readonly workdir: string;
  readonly port: MessagePort;
  readonly resume?: IScanResumeOptions;
}

// Piscina's task entry point - runs inside a worker thread, so it can't
// reach NestJS's DI container. GitCliAdapter is a plain class (its
// @Injectable() decorator is inert without Nest's container), so it's
// instantiated directly here instead.
export default async function runScanTask(
  data: IScanWorkerTaskData,
): Promise<TScanJobResult> {
  const useCase = new RunScanJobUseCase(new GitCliAdapter());
  const events: IScanJobEvent[] = [];
  const flush = async () => {
    if (events.length === 0) return;
    const acknowledged = once(data.port, 'message');
    data.port.postMessage({ type: 'events', events: events.splice(0) });
    await acknowledged;
  };
  const result = await useCase.execute(
    data.repoRef,
    data.cloneSource,
    data.workdir,
    (event) => {
      events.push(event);
      if (events.length >= 256 || event.type === 'progress') return flush();
    },
    data.resume,
  );
  await flush();
  // FIFO on the same port proves all events have arrived. A setImmediate on
  // Piscina's independent result channel cannot provide that guarantee.
  data.port.postMessage({ type: 'complete' });
  return result;
}
