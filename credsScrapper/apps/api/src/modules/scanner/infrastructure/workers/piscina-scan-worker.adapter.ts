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
import { TScanMessage } from './types/scan-message.type';
import { SCAN_WORKER_POOL_SIZE } from './pool-size';
import { IScanResumeOptions } from '../../application/types/scan-checkpoint.type';

@Injectable()
export class PiscinaScanWorkerAdapter
  extends ScanWorkerPort
  implements OnModuleDestroy
{
  // ts-jest's integration test imports this .ts file directly, so
  // __dirname resolves to the real on-disk src/ path (no compiled .js
  // there) rather than dist/ (real dev/prod always builds via tsc first,
  // so __dirname there is already dist/). Gated on JEST_WORKER_ID rather
  // than pattern-matching the path string itself, so this substitution
  // can never misfire in a real deployment whose checkout path happens
  // to contain "/src/" earlier than the intended segment.
  private readonly pool = new Piscina({
    filename: path.resolve(
      process.env.JEST_WORKER_ID !== undefined
        ? __dirname.replace(
            `${path.sep}src${path.sep}`,
            `${path.sep}dist${path.sep}`,
          )
        : __dirname,
      'scan.worker.js',
    ),
    maxThreads: SCAN_WORKER_POOL_SIZE,
  });

  async run(
    repoRef: IRepoRef,
    cloneSource: string,
    workdir: string,
    onEvent: (event: IScanJobEvent) => void,
    resume?: IScanResumeOptions,
  ): Promise<TScanJobResult> {
    const { port1, port2 } = new MessageChannel();
    const abort = new AbortController();
    const delivered = new Promise<void>((resolve, reject) => {
      port1.on('message', (message: TScanMessage) => {
        try {
          if (message.type === 'complete') resolve();
          else {
            for (const event of message.events) onEvent(event);
            port1.postMessage('ack');
          }
        } catch (error) {
          abort.abort();
          reject(error);
        }
      });
      port1.on('messageerror', (error) => {
        abort.abort();
        reject(error);
      });
    });
    try {
      const [result] = await Promise.all([
        this.pool.run(
          { repoRef, cloneSource, workdir, port: port2, resume },
          { transferList: [port2], signal: abort.signal },
        ) as Promise<TScanJobResult>,
        delivered,
      ]);
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
