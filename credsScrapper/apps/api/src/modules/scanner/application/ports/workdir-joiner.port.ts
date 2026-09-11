// Isolates the node:path/node:fs calls run-scan-loop.use-case.ts needs
// (building each worker's scratch-clone path, ensuring the root exists)
// behind a port, for the same reason as WorkdirCleanerPort.
export abstract class WorkdirJoinerPort {
  abstract join(...segments: string[]): string;
  abstract ensureDir(path: string): Promise<void>;
}
