// Application-layer use-cases must not import NestJS directly (zero
// framework dependency), so logging goes through this port instead of
// `new Logger(...)` from '@nestjs/common'. The infrastructure adapter
// wraps NestJS's real Logger.
export abstract class LoggerPort {
  abstract log(message: string): void;
  abstract error(message: string): void;
}
