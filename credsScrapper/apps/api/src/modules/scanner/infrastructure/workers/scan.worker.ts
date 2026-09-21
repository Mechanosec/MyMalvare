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

  const send = async (events: readonly IScanJobEvent[]) => {
    if (events.length === 0) return;
    const acknowledged = once(data.port, 'message');
    data.port.postMessage({ type: 'events', events });
    await acknowledged;
  };

  type TFindingEvent = Extract<IScanJobEvent, { type: 'finding' }>;
  interface ICompactedFinding {
    event: TFindingEvent;
    readonly commitShas: Set<string>;
  }
  const findings = new Map<string, Map<string, ICompactedFinding>>();
  const collectFinding = (event: TFindingEvent) => {
    let findingsByValue = findings.get(event.finding.secretType);
    if (!findingsByValue) {
      findingsByValue = new Map();
      findings.set(event.finding.secretType, findingsByValue);
    }
    const existing = findingsByValue.get(event.finding.secretValue);
    if (!existing) {
      findingsByValue.set(event.finding.secretValue, {
        event,
        commitShas: new Set([event.commitSha]),
      });
      return;
    }

    existing.commitShas.add(event.commitSha);
    if (
      existing.event.filePath.startsWith('<commit-diff>') &&
      !event.filePath.startsWith('<commit-diff>')
    ) {
      existing.event = event;
    }
  };

  const flushFindings = async () => {
    let batch: IScanJobEvent[] = [];
    for (const findingsByValue of findings.values()) {
      for (const compacted of findingsByValue.values()) {
        batch.push({
          ...compacted.event,
          commitShas: [...compacted.commitShas],
        });
        if (batch.length === 256) {
          await send(batch);
          batch = [];
        }
      }
    }
    await send(batch);
  };

  const result = await useCase.execute(
    data.repoRef,
    data.cloneSource,
    data.workdir,
    (event) => {
      if (event.type === 'finding') {
        collectFinding(event);
        return;
      }
      return send([event]);
    },
    data.resume,
  );
  await flushFindings();
  // FIFO on the same port proves all events have arrived. A setImmediate on
  // Piscina's independent result channel cannot provide that guarantee.
  data.port.postMessage({ type: 'complete' });
  return result;
}
