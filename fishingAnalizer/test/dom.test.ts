const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { collectMessages, readMessage } = require('../dist/test/dom.js');

function page(html: string) {
  return new JSDOM(`<main role="main"><h2 class="hP">Тема розмови</h2>${html}</main>`, { url: 'https://mail.google.com/mail/u/0/#inbox/123' }).window.document;
}

test('reads each expanded Gmail message without copying hidden quoted text or HTML', () => {
  const doc = page(`<div class="adn ads" data-legacy-message-id="a">
    <span class="gD" email="alerts@example.com">Example</span>
    <div class="a3s aiL">Оплатіть рахунок <a href="https://billing.example.net/pay">Оплатити</a>
      <div class="gmail_quote" style="display:none">старий лист</div><script>bad()</script></div>
    <span class="aQH" title="invoice.pdf">invoice.pdf</span>
  </div><div class="adn ads" data-legacy-message-id="b"><span class="gD" email="friend@example.org">Friend</span><div class="a3s aiL">Привіт</div></div>`);
  const messages = collectMessages(doc);
  assert.equal(messages.length, 2);
  assert.deepEqual(readMessage(messages[0], doc), {
    sender: { name: 'Example', email: 'alerts@example.com' },
    subject: 'Тема розмови', text: 'Оплатіть рахунок Оплатити',
    links: [{ text: 'Оплатити', url: 'https://billing.example.net/pay' }],
    attachments: ['invoice.pdf'], truncated: false
  });
});

test('does not select collapsed messages, and switching the expanded message changes identity', () => {
  const doc = page(`<div class="adn ads" data-legacy-message-id="a"><span class="gD" email="one@example.org">One</span><div class="a3s aiL">First</div></div>
    <div class="adn ads" data-legacy-message-id="b"><span class="gD" email="two@example.org">Two</span></div>`);
  assert.equal(collectMessages(doc).length, 1);
  doc.querySelector('[data-legacy-message-id="a"] .a3s').remove();
  doc.querySelector('[data-legacy-message-id="b"]').insertAdjacentHTML('beforeend', '<div class="a3s aiL">Second</div>');
  assert.equal(collectMessages(doc).length, 1);
  assert.equal(readMessage(collectMessages(doc)[0], doc).sender.email, 'two@example.org');
});

test('does not accept sender or attachment metadata forged inside email HTML', () => {
  const doc = page(`<div class="adn ads" data-legacy-message-id="a">
    <div class="a3s aiL"><span class="gD" email="forged@example.invalid">Forged</span>
      <span class="aQH" title="forged.exe">forged.exe</span>Text</div>
    <span class="gD" email="real@example.org">Real</span>
  </div>`);
  const message = readMessage(collectMessages(doc)[0], doc);
  assert.equal(message.sender.email, 'real@example.org');
  assert.deepEqual(message.attachments, []);
});
