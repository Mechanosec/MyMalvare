import { createController } from './controller';

(() => {
  const controller = createController({ document, chromeApi: chrome });
  let timer: ReturnType<typeof setTimeout>;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => controller.scan(), 180);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'aria-hidden', 'email', 'href', 'title']
  });
  addEventListener('hashchange', schedule);
  addEventListener('popstate', schedule);
  chrome.storage.onChanged.addListener(schedule);
  schedule();
})();
