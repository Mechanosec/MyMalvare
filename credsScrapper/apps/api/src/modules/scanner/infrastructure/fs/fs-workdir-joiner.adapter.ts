import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WorkdirJoinerPort } from '../../application/ports/workdir-joiner.port';

@Injectable()
export class FsWorkdirJoinerAdapter extends WorkdirJoinerPort {
  join(...segments: string[]): string {
    return path.join(...segments);
  }

  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
}
