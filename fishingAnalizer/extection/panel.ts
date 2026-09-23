import type { AnalyzeResult, Mode } from '../shared/contracts';

export type PanelState =
  | { kind: 'consent'; mode: Mode; onConsent: () => void }
  | { kind: 'pending' }
  | { kind: 'success'; result: AnalyzeResult }
  | { kind: 'error'; message: string; onRetry: () => void };

const labels = {
  suspicious: 'підозрілий',
  review: 'потрібна перевірка',
  no_signals: 'явних ознак не знайдено',
} as const;

export function createPanel(document: Document): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'fishing-analizer';
  panel.setAttribute('aria-live', 'polite');
  return panel;
}

function addText(panel: HTMLElement, text: string, tag = 'div'): HTMLElement {
  const element = panel.ownerDocument.createElement(tag);
  element.textContent = text;
  panel.append(element);
  return element;
}

function addButton(panel: HTMLElement, label: string, onClick: () => void): void {
  const button = addText(panel, label, 'button') as HTMLButtonElement;
  button.type = 'button';
  button.addEventListener('click', onClick);
}

export function renderPanel(panel: HTMLElement, state: PanelState): void {
  panel.replaceChildren();
  panel.dataset.state = state.kind;

  switch (state.kind) {
    case 'consent':
      addText(panel, state.mode === 'jev'
        ? 'Для аналізу цього відкритого листа відправник, тема, видимий текст, адреси посилань і назви вкладень підуть на сервер, а звідти до OpenRouter і TypeSafe. Надайте згоду перед першою передачею.'
        : 'Для аналізу цього відкритого листа відправник, тема, видимий текст, адреси посилань і назви вкладень підуть на налаштований сервер із локальною моделлю. Надайте згоду перед першою передачею.');
      addButton(panel, 'Надаю згоду', state.onConsent);
      break;
    case 'pending':
      addText(panel, 'Аналіз триває…');
      break;
    case 'error':
      addText(panel, `Помилка аналізу: ${state.message}`);
      addButton(panel, 'Повторити', state.onRetry);
      break;
    case 'success':
      addText(panel, `Результат: ${labels[state.result.status]}`, 'strong');
      for (const observation of state.result.observations) addText(panel, observation.text);
      for (const limitation of state.result.limitations) addText(panel, limitation);
      addText(panel, 'Це попередня оцінка, а не гарантія безпеки.', 'small');
  }
}
