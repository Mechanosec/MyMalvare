import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import Piscina from 'piscina';
import { ScanWorkerPort } from '../../application/ports/scan-worker.port';
import {
  IScanJobEvent,
  TScanJobResult,
} from '../../application/use-cases/run-scan-job.use-case';
import { IRepoRef } from '../../domain/types/repo-ref.type';
import { SCAN_WORKER_POOL_SIZE } from './pool-size';

@Injectable()
export class PiscinaScanWorkerAdapter
  extends ScanWorkerPort
  implements OnModuleDestroy
{
  // `scan.worker.js` (compiled sibling of scan.worker.ts) - resolved
  // relative to this file's own compiled location in dist/, so it works
  // the same in dev (`nest start`, which builds to dist/ via tsc, not
  // ts-node) and in prod (`node dist/main`). Under ts-jest (integration
  // tests import this .ts file directly), __dirname is the src/ path
  // instead, where only the .ts source exists - Piscina needs a real
  // file to load into the worker thread, so redirect to the mirrored
  // dist/ path in that one case (a no-op everywhere else).
  private readonly pool = new Piscina({
    filename: path.resolve(
      __dirname.replace(
        `${path.sep}src${path.sep}`,
        `${path.sep}dist${path.sep}`,
      ),
      'scan.worker.js',
    ),
    maxThreads: SCAN_WORKER_POOL_SIZE,
  });

  async run(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => void,
  ): Promise<TScanJobResult> {
    const { port1, port2 } = new MessageChannel();
    port1.on('message', (event: IScanJobEvent) => onEvent(event));
    try {
      const result = await this.pool.run(
        { repoRef, cloneSource, workdir, port: port2 },
        { transferList: [port2] },
      );
      // Piscina's own result-delivery channel and this port are
      // independent MessagePorts with no cross-port ordering guarantee -
      // flush one macrotask so any in-flight progress/finding messages
      // land before we return (see ledger entry, Task 4/5).
      await new Promise((resolve) => setImmediate(resolve));
      return result;
    } finally {
      port1.close();
    }
  }

  async close(): Promise<void> {
    await this.pool.destroy();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
