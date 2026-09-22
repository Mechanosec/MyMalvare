export class ScanControlError extends Error {
  constructor(readonly code: 'scan_stopping' | 'scan_control_unavailable') {
    super(code);
    this.name = 'ScanControlError';
  }
}
