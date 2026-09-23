import type { MailMessage } from '../shared/contracts';

const MESSAGE_SELECTOR = '[role="main"] .adn.ads';
const BODY_SELECTOR = '.a3s';
const PANEL_SELECTOR = '.fishing-analizer';
const SENDER_SELECTOR = '.gD[email], .gD[data-email]';
const ATTACHMENT_SELECTOR = '.aQH[title], .aV3[title], .aQy[title]';
const TEXT_NODE_FILTER = 4;
const TEXT_LIMIT = 12000;
const LINK_LIMIT = 30;

function isVisible(node: Node): boolean {
  let element: Element | null = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element) {
    if (element.matches(PANEL_SELECTOR) ||
        (element as HTMLElement).hidden ||
        element.getAttribute('aria-hidden') === 'true') return false;

    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    element = element.parentElement;
  }
  return true;
}

function clean(value: unknown, limit: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function visibleText(element: Element): string {
  const walker = element.ownerDocument.createTreeWalker(element, TEXT_NODE_FILTER);
  const parts: string[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('script,style,template,noscript') || !isVisible(node)) continue;
    parts.push(node.nodeValue || '');
  }

  return clean(parts.join(' '), TEXT_LIMIT);
}

export function collectMessages(document: Document): Element[] {
  return [...document.querySelectorAll(MESSAGE_SELECTOR)].filter(message => {
    const body = message.querySelector(BODY_SELECTOR);
    return !!body && isVisible(body);
  });
}

export function readMessage(node: Element, document: Document = node.ownerDocument): MailMessage {
  const body = node.querySelector(BODY_SELECTOR)!;
  const sender = [...node.querySelectorAll(SENDER_SELECTOR)].find(element => !body.contains(element));
  const text = visibleText(body);

  const links = [...body.querySelectorAll('a[href]')]
    .filter(isVisible)
    .slice(0, LINK_LIMIT)
    .map(link => ({
      text: clean(visibleText(link), 160),
      url: clean((link as HTMLAnchorElement).href || link.getAttribute('href'), 2048),
    }));

  const attachments = [...node.querySelectorAll(ATTACHMENT_SELECTOR)]
    .filter(element => !body.contains(element) && isVisible(element))
    .map(element => clean(element.getAttribute('title'), 255))
    .filter(Boolean)
    .slice(0, 20);

  return {
    sender: {
      name: clean(sender?.textContent, 200),
      email: clean(sender?.getAttribute('email') || sender?.getAttribute('data-email'), 320),
    },
    subject: clean(document.querySelector('[role="main"] h2.hP')?.textContent, 500),
    text,
    links,
    attachments,
    truncated: text.length >= TEXT_LIMIT || body.querySelectorAll('a[href]').length > LINK_LIMIT,
  };
}
