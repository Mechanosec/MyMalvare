import { Injectable, Logger } from '@nestjs/common';
import { LoggerPort } from '../../application/ports/logger.port';

@Injectable()
export class NestLoggerAdapter extends LoggerPort {
  private readonly logger = new Logger('Scanner');

  log(message: string): void {
    this.logger.log(message);
  }

  error(message: string): void {
    this.logger.error(message);
  }
}
