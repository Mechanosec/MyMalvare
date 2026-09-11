// `workdir` is deliberately NOT a client-controlled field: it's a
// filesystem path the server writes to and deletes recursively
// (ScanRepositoryUseCase's clone + cleanup). Accepting it from an HTTP
// caller would be a path-traversal / arbitrary-filesystem-write hole.
// The server picks the workdir itself (see SCAN_WORKDIR in scan.controller.ts).
export class StartScanDto {
  workers?: number;
  maxRepos?: number;
  staleTimeoutSeconds?: number;
}
