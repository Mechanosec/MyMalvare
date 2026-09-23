export type Mode = 'jev' | 'local';
export type Status = 'suspicious' | 'review' | 'no_signals';

export type MailMessage = {
  sender: { name: string; email: string };
  subject: string;
  text: string;
  links: { text: string; url: string }[];
  attachments: string[];
  truncated: boolean;
};

export type Observation = { code: string; text: string };
export type AnalyzeResult = {
  requestId: string;
  mode: Mode;
  model: string;
  status: Status;
  observations: Observation[];
  limitations: string[];
  elapsedMs: number;
};
export type AnalyzeRequest = { requestId: string; mode: Mode; message: MailMessage };
export type AnalysisFailure = { requestId?: string; error: { code: string; message: string } };

export function isMode(value: unknown): value is Mode {
  return value === 'jev' || value === 'local';
}

export function isStatus(value: unknown): value is Status {
  return value === 'suspicious' || value === 'review' || value === 'no_signals';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringWithin(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

export function isMailMessage(value: unknown): value is MailMessage {
  if (!isRecord(value) || !isRecord(value.sender)) return false;
  return isStringWithin(value.sender.name, 500) &&
    isStringWithin(value.sender.email, 500) &&
    isStringWithin(value.subject, 1000) &&
    isStringWithin(value.text, 30000) &&
    Array.isArray(value.links) && value.links.length <= 100 &&
    value.links.every(link => isRecord(link) && isStringWithin(link.text, 1000) && isStringWithin(link.url, 4000)) &&
    Array.isArray(value.attachments) && value.attachments.length <= 50 &&
    value.attachments.every(name => isStringWithin(name, 500)) &&
    typeof value.truncated === 'boolean';
}

export function isAnalyzeResult(value: unknown): value is AnalyzeResult {
  return isRecord(value) && typeof value.requestId === 'string' && isMode(value.mode) &&
    typeof value.model === 'string' && isStatus(value.status) &&
    Array.isArray(value.observations) && value.observations.every(item => isRecord(item) &&
      typeof item.code === 'string' && typeof item.text === 'string') &&
    Array.isArray(value.limitations) && value.limitations.every(item => typeof item === 'string') &&
    typeof value.elapsedMs === 'number';
}
