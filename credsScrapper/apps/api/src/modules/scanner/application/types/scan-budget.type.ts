import { EScanPhase } from '../../domain/constant/scan-phase.constant';
import { IScanCheckpoint } from './scan-checkpoint.type';
import { ESecretType } from '../../domain/constant/secret-type.constant';

export interface IScanBudget {
  readonly maxDurationMs: number;
  readonly maxCacheBytes: number;
}

export interface IScanExecutionOptions {
  readonly secretTypes?: readonly ESecretType[];
  readonly phase: EScanPhase;
  readonly targetSha?: string;
  readonly checkpoint?: IScanCheckpoint;
  readonly scannerVersion: string;
  readonly budget: IScanBudget;
  readonly signal: AbortSignal;
}

export function positiveInteger(name: string, fallback: number): number {
  const value =
    process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const HEAD_SCAN_BUDGET: IScanBudget = {
  maxDurationMs: positiveInteger('HEAD_SCAN_TIMEOUT_MS', 120_000),
  maxCacheBytes: positiveInteger(
    'HEAD_SCAN_MAX_CACHE_BYTES',
    512 * 1024 * 1024,
  ),
};

export const HISTORY_SCAN_BUDGET: IScanBudget = {
  maxDurationMs: positiveInteger('HISTORY_SCAN_TIMEOUT_MS', 15 * 60_000),
  maxCacheBytes: positiveInteger(
    'HISTORY_SCAN_MAX_CACHE_BYTES',
    2 * 1024 * 1024 * 1024,
  ),
};
