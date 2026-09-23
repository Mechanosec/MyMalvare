import type { AnalyzeResult, MailMessage, Mode, Observation, Status } from '../shared/contracts';
import { decide } from './adapters';
import type { HandlerOptions } from './http';

function collectObservations(message: MailMessage): Observation[] {
  const found: Observation[] = [];
  const senderDomain = message.sender.email.split('@')[1]?.toLowerCase();
  if (/(?:enter|send|provide).{0,80}(?:password|verification code|one.time code|otp)|(?:введіть|надішліть|повідомте).{0,80}(?:пароль|код підтвердження|одноразовий код)/i.test(message.text)) {
    found.push({ code: 'credential_request', text: 'Текст листа просить ввести або передати пароль чи код підтвердження.' });
  }
  for (const link of message.links) {
    let target;
    try { target = new URL(link.url); } catch { continue; }
    if (!['http:', 'https:'].includes(target.protocol)) continue;
    const host = target.hostname.toLowerCase();
    if (senderDomain && host !== senderDomain && !host.endsWith(`.${senderDomain}`) &&
        !found.some(x => x.code === 'sender_link_domain_mismatch')) {
      found.push({ code: 'sender_link_domain_mismatch', text: `Домен відправника ${senderDomain} відрізняється від домену посилання ${host}.` });
    }
    const shown = link.text.trim();
    if (/^https?:\/\//i.test(shown)) {
      try {
        const shownHost = new URL(shown).hostname.toLowerCase();
        if (shownHost !== host && !found.some(x => x.code === 'link_label_mismatch')) {
          found.push({ code: 'link_label_mismatch', text: `Видима адреса вказує на ${shownHost}, а посилання веде на ${host}.` });
        }
      } catch { /* visible label is not a valid URL */ }
    }
  }
  return found;
}

function resolveStatus(choice: Status, signs: Observation[], truncated: boolean): Status {
  let status = choice;
  if (signs.some(x => x.code === 'link_label_mismatch')) status = 'suspicious';
  else if (signs.length && status === 'no_signals') status = 'review';
  if (truncated && status === 'no_signals') status = 'review';
  return status;
}

function buildLimitations(mode: Mode, signs: Observation[], truncated: boolean): string[] {
  const limitations = ['Оцінка стосується лише видимих даних листа і не гарантує безпеки.'];
  if (mode === 'local') limitations.push('Laya Multilingual має контекст 1024 токени; довший лист може бути охоплений не повністю.');
  if (truncated) limitations.push('Текст листа було скорочено перед аналізом.');
  if (!signs.length) limitations.push('Конкретних ознак у доступних полях не виявлено; оцінка моделі потребує людської перевірки.');
  return limitations;
}

export async function analyze(mode: Mode, message: MailMessage, options: HandlerOptions = {}): Promise<Omit<AnalyzeResult, 'requestId' | 'mode'>> {
  const start = performance.now();
  const signs = collectObservations(message);
  const decision = await decide(mode, message, options);
  return {
    model: decision.model,
    status: resolveStatus(decision.choice, signs, message.truncated),
    observations: signs,
    limitations: buildLimitations(mode, signs, message.truncated),
    elapsedMs: Math.round(performance.now() - start),
  };
}
