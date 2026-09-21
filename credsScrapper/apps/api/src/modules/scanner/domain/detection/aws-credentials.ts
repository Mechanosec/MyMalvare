import { ESecretType } from '../constant/secret-type.constant';
import { IFinding } from '../types/finding.type';
import {
  IAwsCredentials,
  IAwsCredentialCandidate,
} from '../types/aws-credentials.type';

const ACCESS = ESecretType.AWS_ACCESS_KEY_ID;
const PRIVATE = ESecretType.AWS_SECRET_ACCESS_KEY;
const accessName =
  /^(?:AWS_ACCESS_KEY_ID|aws_access_key_id|accessKeyId|awsAccessKeyId)$/i;
const privateName =
  /^(?:AWS_SECRET_ACCESS_KEY|AWS_SECRET_KEY|SECRET_ACCESS_KEY|secretAccessKey|awsSecretAccessKey)$/i;
const tokenName =
  /^(?:AWS_SESSION_TOKEN|aws_session_token|sessionToken|awsSessionToken)$/i;
const MAX_JSON_LENGTH = 8192;
const assignment =
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*["']?([^"'\s,}]+)["']?\s*$/;

function candidates(text: string): IAwsCredentialCandidate[] {
  const lines = text.split('\n');
  const result: IAwsCredentialCandidate[] = [];
  let block: { name: string; value: string; line: number }[] = [];
  let blockSide = '';
  let invalidBlock = false;

  function flush(): void {
    if (invalidBlock || block.length < 2) {
      invalidBlock = false;
      block = [];
      return;
    }
    const access = block.filter((item) => accessName.test(item.name));
    const secret = block.filter((item) => privateName.test(item.name));
    const token = block.filter((item) => tokenName.test(item.name));
    if (
      access.length === 1 &&
      secret.length === 1 &&
      token.length <= 1 &&
      block.every(
        (item) =>
          accessName.test(item.name) ||
          privateName.test(item.name) ||
          tokenName.test(item.name),
      )
    ) {
      result.push({
        access: access[0].value,
        private: secret[0].value,
        ...(token.length ? { sessionToken: token[0].value } : {}),
        start: block[0].line,
        end: block[block.length - 1].line,
      });
    }
    block = [];
    invalidBlock = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.startsWith('@@') ||
      line.startsWith('+++') ||
      line.startsWith('---')
    ) {
      flush();
      continue;
    }
    const side = line.startsWith('+') || line.startsWith('-') ? line[0] : '';
    if (side !== blockSide) flush();
    blockSide = side;
    const match = assignment.exec(side ? line.slice(1) : line);
    if (
      !match ||
      (!accessName.test(match[1]) &&
        !privateName.test(match[1]) &&
        !tokenName.test(match[1]))
    ) {
      flush();
      continue;
    }
    if (!invalidBlock) {
      block.push({ name: match[1], value: match[2], line: i + 1 });
      if (block.length > 3) {
        block = [];
        invalidBlock = true;
      }
    }
  }
  flush();

  // Bound both parsing work and candidate size; advance the line cursor only
  // once instead of recounting the prefix for every object.
  let cursor = 0;
  let line = 1;
  let lineStart = 0;
  for (const match of text.matchAll(/\{[^{}]{0,8190}\}/g)) {
    const body = match[0];
    if (body.length > MAX_JSON_LENGTH || !body.includes('\"')) continue;
    const offset = match.index ?? 0;
    for (let i = cursor; i < offset; i++) {
      if (text[i] === '\n') {
        line++;
        lineStart = i + 1;
      }
    }
    cursor = offset;
    // A complete JSON object in a unified diff has one +/- marker before
    // every line. Normalize only when the opening brace and every following
    // line share the same side; mixed sides and context are not one object.
    const prefix = text.slice(lineStart, offset);
    const side = /^[+-]\s*$/.test(prefix) ? prefix[0] : '';
    const parts = body.split('\n');
    if (
      side &&
      parts
        .slice(1)
        .some(
          (part) => !part.startsWith(side) || part.startsWith(side.repeat(3)),
        )
    )
      continue;
    const json = side
      ? [parts[0], ...parts.slice(1).map((part) => part.slice(1))].join('\n')
      : body;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      continue;
    const entries = Object.entries(parsed);
    const access = entries.filter(([name]) => accessName.test(name));
    const secret = entries.filter(([name]) => privateName.test(name));
    const token = entries.filter(([name]) => tokenName.test(name));
    // JSON.parse silently overwrites duplicate properties. Count the raw
    // credential property names as well before trusting the parsed values.
    const rawNames = [
      ...json.matchAll(/\"([A-Za-z_][A-Za-z_0-9]*)\"\s*:/g),
    ].map((entry) => entry[1]);
    if (
      rawNames.filter((name) => accessName.test(name)).length !== 1 ||
      rawNames.filter((name) => privateName.test(name)).length !== 1 ||
      rawNames.filter((name) => tokenName.test(name)).length > 1
    )
      continue;
    if (
      access.length !== 1 ||
      secret.length !== 1 ||
      token.length > 1 ||
      typeof access[0][1] !== 'string' ||
      typeof secret[0][1] !== 'string' ||
      (token.length && typeof token[0][1] !== 'string')
    )
      continue;
    const end = line + body.split('\n').length - 1;
    result.push({
      access: access[0][1],
      private: secret[0][1],
      ...(token.length ? { sessionToken: token[0][1] as string } : {}),
      start: line,
      end,
    });
  }
  return result;
}

export function pairAwsCredentials(
  text: string,
  findings: readonly IFinding[],
): IFinding[] {
  const byLine = new Map<number, Map<ESecretType, Map<string, IFinding[]>>>();
  let hasAccess = false;
  let hasPrivate = false;
  for (const finding of findings) {
    if (
      finding.secretType !== ACCESS &&
      finding.secretType !== PRIVATE &&
      finding.secretType !== ESecretType.GENERIC_HIGH_ENTROPY
    )
      continue;
    if (finding.secretType === ACCESS) hasAccess = true;
    else if (finding.secretType === PRIVATE) hasPrivate = true;
    let byType = byLine.get(finding.lineNumber);
    if (!byType) {
      byType = new Map();
      byLine.set(finding.lineNumber, byType);
    }
    let byValue = byType.get(finding.secretType);
    if (!byValue) {
      byValue = new Map();
      byType.set(finding.secretType, byValue);
    }
    const bucket = byValue.get(finding.secretValue) ?? [];
    bucket.push(finding);
    byValue.set(finding.secretValue, bucket);
  }
  if (!hasAccess || !hasPrivate) return [...findings];

  const replacements = new Map<IFinding, IFinding>();
  const removed = new Set<IFinding>();
  for (const candidate of candidates(text)) {
    let access: IFinding | undefined;
    let secret: IFinding | undefined;
    let ambiguous = false;
    for (let line = candidate.start; line <= candidate.end; line++) {
      const accessBucket =
        byLine.get(line)?.get(ACCESS)?.get(candidate.access) ?? [];
      const secretBucket =
        byLine.get(line)?.get(PRIVATE)?.get(candidate.private) ?? [];
      if (accessBucket.length > 1 || secretBucket.length > 1) {
        ambiguous = true;
        break;
      }
      if (accessBucket.length === 1 && !replacements.has(accessBucket[0])) {
        if (access) {
          ambiguous = true;
          break;
        }
        access = accessBucket[0];
      }
      if (secretBucket.length === 1 && !removed.has(secretBucket[0])) {
        if (secret) {
          ambiguous = true;
          break;
        }
        secret = secretBucket[0];
      }
    }
    if (ambiguous || !access || !secret) continue;
    replacements.set(access, {
      ...access,
      secretValue: JSON.stringify({
        access: candidate.access,
        private: candidate.private,
        ...(candidate.sessionToken
          ? { sessionToken: candidate.sessionToken }
          : {}),
      }),
    });
    removed.add(secret);
    if (candidate.sessionToken) {
      let token: IFinding | undefined;
      let ambiguousToken = false;
      for (let line = candidate.start; line <= candidate.end; line++) {
        const bucket =
          byLine
            .get(line)
            ?.get(ESecretType.GENERIC_HIGH_ENTROPY)
            ?.get(candidate.sessionToken) ?? [];
        if (bucket.length > 1 || (bucket.length === 1 && token)) {
          ambiguousToken = true;
          break;
        }
        if (bucket.length === 1) token = bucket[0];
      }
      if (token && !ambiguousToken) removed.add(token);
    }
  }
  return findings
    .filter((finding) => !removed.has(finding))
    .map((finding) => replacements.get(finding) ?? finding);
}

export function parseAwsCredentials(value: string): IAwsCredentials | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.access !== 'string' ||
      !/^(?:AKIA|ASIA)[A-Z0-9]{16}$/.test(candidate.access) ||
      typeof candidate.private !== 'string' ||
      !/^[A-Za-z0-9/+=]{40}$/.test(candidate.private) ||
      (candidate.sessionToken !== undefined &&
        typeof candidate.sessionToken !== 'string')
    )
      return null;
    return {
      access: candidate.access,
      private: candidate.private,
      ...(typeof candidate.sessionToken === 'string'
        ? { sessionToken: candidate.sessionToken }
        : {}),
    };
  } catch {
    return null;
  }
}
