import { isMode } from '../shared/contracts';
import { DEFAULT_SETTINGS, serverEndpoint } from '../shared/settings';

const server = document.getElementById('server') as HTMLInputElement;
const mode = document.getElementById('mode') as HTMLSelectElement;
const status = document.getElementById('status') as HTMLElement;
chrome.storage.sync.get(['serverUrl', 'mode']).then(raw => {
  const saved = raw as { serverUrl?: string; mode?: string };
  server.value = saved.serverUrl || DEFAULT_SETTINGS.serverUrl;
  mode.value = saved.mode || DEFAULT_SETTINGS.mode;
});
document.getElementById('settings')!.addEventListener('submit', async event => {
  event.preventDefault();
  const value = server.value.trim().replace(/\/$/, '');
  try {
    if (!serverEndpoint(value) || !isMode(mode.value)) throw Error();
    await chrome.storage.sync.set({ serverUrl: value, mode: mode.value });
    status.textContent = 'Налаштування збережено. Поверніться до відкритого листа Gmail.';
  } catch {
    status.textContent = 'Вкажіть HTTP адресу localhost або 127.0.0.1 без шляху, наприклад http://127.0.0.1:8787.';
  }
});
document.getElementById('revoke')!.addEventListener('click', async () => {
  await chrome.storage.local.set({ consents: {}, consentsRevokedAt: Date.now() });
  status.textContent = 'Згоди відкликано. Наступна перевірка попросить згоду знову.';
});
