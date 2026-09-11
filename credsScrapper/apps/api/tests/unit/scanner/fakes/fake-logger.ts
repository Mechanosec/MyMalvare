import { LoggerPort } from '../../../../src/modules/scanner/application/ports/logger.port';

export class FakeLogger extends LoggerPort {
  log(): void {}
  error(): void {}
}
