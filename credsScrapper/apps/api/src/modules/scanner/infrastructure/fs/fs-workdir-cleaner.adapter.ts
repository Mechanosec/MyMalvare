import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { WorkdirCleanerPort } from '../../application/ports/workdir-cleaner.port';

@Injectable()
export class FsWorkdirCleanerAdapter extends WorkdirCleanerPort {
  async remove(path: string): Promise<void> {
    await fs.rm(path, { recursive: true, force: true });
  }
}
