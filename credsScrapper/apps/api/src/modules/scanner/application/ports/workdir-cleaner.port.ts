// Isolates the one bit of raw filesystem I/O scan-repository.use-case.ts
// needs (wiping the scratch clone directory) behind a port, so the
// application layer has zero Node-fs/infrastructure dependency, not just
// zero NestJS/Prisma dependency.
export abstract class WorkdirCleanerPort {
  abstract remove(path: string): Promise<void>;
}
