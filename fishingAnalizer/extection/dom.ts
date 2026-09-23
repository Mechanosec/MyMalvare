import type { MailMessage } from '../shared/contracts';

  const MESSAGE = '[role="main"] .adn.ads';
  const BODY = '.a3s';
  const own = '.fishing-analizer';

  function visible(node: Node): boolean {
    for (let element: Element | null = node.nodeType === 1 ? node as Element : node.parentElement; element; element = element.parentElement) {
      if (element.matches?.(own) || (element as HTMLElement).hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  }

  function clean(value: unknown, limit: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function visibleText(element: Element): string {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, 4);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest('script,style,template,noscript') && visible(node)) parts.push(node.nodeValue || '');
    }
    return clean(parts.join(' '), 12000);
  }

  export function collectMessages(doc: Document): Element[] {
    return [...doc.querySelectorAll(MESSAGE)].filter(node => {
      const body = node.querySelector(BODY);
      return !!body && visible(body);
    });
  }

  export function readMessage(node: Element, doc: Document = node.ownerDocument): MailMessage {
    const body = node.querySelector(BODY)!;
    const sender = [...node.querySelectorAll('.gD[email], .gD[data-email]')].find(item => !body.contains(item));
    const text = visibleText(body);
    const links = [...body.querySelectorAll('a[href]')].filter(visible).slice(0, 30).map(link => ({
      text: clean(visibleText(link), 160), url: clean((link as HTMLAnchorElement).href || link.getAttribute('href'), 2048)
    }));
    const attachments = [...node.querySelectorAll('.aQH[title], .aV3[title], .aQy[title]')]
      .filter(item => !body.contains(item) && visible(item)).map(item => clean(item.getAttribute('title'), 255)).filter(Boolean).slice(0, 20);
    return {
      sender: { name: clean(sender?.textContent, 200), email: clean(sender?.getAttribute('email') || sender?.getAttribute('data-email'), 320) },
      subject: clean(doc.querySelector('[role="main"] h2.hP')?.textContent, 500),
      text, links, attachments,
      truncated: text.length >= 12000 || body.querySelectorAll('a[href]').length > 30
    };
  }
