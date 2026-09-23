export const homePage = `<!doctype html>
<html lang="uk">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fishing Analizer — backend</title>
<style>
  :root { color-scheme: dark; font: 16px/1.5 system-ui, sans-serif; background: #101115; color: #f5f5f6; }
  body { max-width: 700px; margin: 8vh auto; padding: 0 24px; }
  .badge { display: inline-block; padding: 5px 12px; border-radius: 999px; background: #253b31; color: #9ae4b6; font-size: .85rem; }
  h1 { font-size: clamp(2rem, 5vw, 3rem); margin: 20px 0 8px; }
  p { color: #c6c7ce; }
  ol { padding-left: 24px; }
  li { margin: 16px 0; }
  code { color: #e8f97a; background: #26272b; padding: 3px 6px; border-radius: 5px; overflow-wrap: anywhere; }
  a { color: #d7ed76; }
  .card { background: #1c1d21; border: 1px solid #36373c; border-radius: 18px; padding: 22px 28px; margin-top: 30px; }
</style>
<main>
  <span class="badge">● Backend працює</span>
  <h1>Fishing Analizer</h1>
  <p>Це адреса локального сервера аналізу. Саме розширення працює в Chrome поруч із відкритим листом Gmail.</p>
  <section class="card" aria-label="Як підключити розширення">
    <h2>Як підключити</h2>
    <ol>
      <li>Відкрийте <code>chrome://extensions</code>, увімкніть режим розробника та завантажте каталог <code>fishingAnalizer/dist/extection</code> через Load unpacked.</li>
      <li>У налаштуваннях встановленого розширення введіть адресу сервера <code>http://127.0.0.1:8787</code> і виберіть модель.</li>
      <li>Відкрийте лист у Gmail. Перед першою передачею даних розширення запитає згоду.</li>
    </ol>
  </section>
  <p>Технічна перевірка сервера: <a href="/health">/health</a>. Аналіз виконується через <code>POST /analyze</code>; відкривати його як сторінку не потрібно.</p>
</main>
</html>`;
