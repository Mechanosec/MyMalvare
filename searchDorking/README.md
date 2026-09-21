# searchDorking

Бере список значень (наприклад, витягнутих credsScrapper'ом фрагментів
ключів чи назв проєктів) і генерує з них Google dork-запити для пошуку
слідів у відкритому доступі (пробитий `.env`, `.git`, лог, паст тощо).

## Використання

```bash
node cli.js "значення1" "значення2"
```

Без налаштованого API це просто виведе список готових URL для
`google.com/search` — відкриваєш вручну в браузері:

```
[filetype:env "значення1"]
https://www.google.com/search?q=filetype%3Aenv%20%22%D0%B7%D0%BD%D0%B0%D1%87%D0%B5%D0%BD%D0%BD%D1%8F1%22
```

## Автоматичний пошук (опційно)

Щоб отримувати результати одразу в консолі (без відкриття браузера),
налаштуй [Google Programmable Search](https://developers.google.com/custom-search/v1/overview):

1. Створи Custom Search Engine на https://programmablesearchengine.google.com/ (у налаштуваннях увімкни "Search the entire web") — отримаєш `cx`.
2. Отримай API-ключ на https://console.cloud.google.com/apis/credentials (увімкнена Custom Search API).
3. Виставь змінні середовища:

```bash
export GOOGLE_API_KEY=...
export GOOGLE_CX=...
node cli.js "значення1"
```

Тоді для кожного dork-запиту прийдуть реальні результати (title +
link) замість URL.

## Файли

- `dorks.js` — шаблони dork-запитів (`DORK_TEMPLATES`) та побудова
  запитів/URL з переданих значень.
- `search.js` — виконує пошук: через Custom Search API якщо ключі
  задані, інакше просто повертає URL.
- `cli.js` — CLI-обгортка над `search.js`.
- `test_dorks.js` — самоперевірка (`npm test`).

## Обмеження

- Без API-ключа скрипт **не** скрейпить google.com напряму (заборонено
  ToS, миттєво ловить капчу) — тільки видає готові посилання.
- Free tier Custom Search API — 100 запитів/день.
- Шаблони dork'ів у `dorks.js` — базовий набір, додавай свої за
  потреби.
