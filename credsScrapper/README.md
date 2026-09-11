# credsScrapper

Утиліта на Python, яка знаходить публічні GitHub-репозиторії, клонує їх
і сканує як поточний вміст файлів, так і повну історію комітів на предмет
залишених секретів (ключі, токени тощо). Стан зберігається в SQLite —
скрипт можна зупиняти і перезапускати, він не пересканує вже оброблені
репозиторії.

Деталі дизайну: `../docs/superpowers/specs/2026-09-11-credscrapper-design.md`
План реалізації: `../docs/superpowers/plans/2026-09-11-credscrapper-implementation.md`

## Встановлення

Потрібен лише Python 3.10+ та `git` у PATH. Сам скрипт залежностей окрім
stdlib не має; `pytest` потрібен тільки для тестів.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

`.venv/bin/activate` вмикає venv у поточному шелі (після цього достатньо
писати `python`, `pytest` без префікса `.venv/bin/`). Вийти — `deactivate`.

## Команди

Скрипт запускається через `-m` — це каже Python виконати пакет `app`
(директорія `app/`, вхідна точка `app/__main__.py`) як модуль, а не як
окремий файл. Це потрібно, щоб працювали внутрішні імпорти на кшталт
`from app.state.db import init_db` — вони розраховані на запуск у складі
пакета, а не напряму (`python app/cli.py` впаде з `ImportError`).

### `discover` — знайти нові репозиторії

Тягне публічні `PushEvent` за минулу годину з [GH Archive](https://www.gharchive.org/)
і додає нові repo_id у чергу кандидатів.

```bash
python -m app discover --db state.db
```

Флаги:
| Флаг | Короткий | Дефолт | Опис |
|---|---|---|---|
| `--db PATH` | `-d` | `state.db` | файл SQLite зі станом |
| `--log-file PATH` | `-l` | `credsscrapper.log` | куди дописувати лог прогресу |

### `scan` — просканувати чергу

Бере кандидатів з черги, клонує (`git clone --bare`), сканує HEAD-дерево
файлів і повну історію комітів (`git log -p`), пише знахідки в SQLite.

```bash
python -m app scan -d state.db -w workdir -j 8
```

Флаги:
| Флаг | Короткий | Дефолт | Опис |
|---|---|---|---|
| `--db PATH` | `-d` | `state.db` | файл SQLite зі станом |
| `--workdir PATH` | `-w` | `workdir` | куди клонити репозиторії під час сканування |
| `--max-repos N` | `-m` | без ліміту | скільки репозиторіїв обробити за один запуск |
| `--stale-timeout SECONDS` | `-s` | `3600` | через скільки секунд "завислий" `in_progress` репозиторій повертається в чергу |
| `--workers N` | `-j` | `1` | скільки репозиторіїв клонувати/сканувати одночасно (паралельно, через потоки) |
| `--resume` | `-r` | — | no-op; скан завжди резюмиться сам за станом у SQLite, флаг лишений для наочності команди |
| `--log-file PATH` | `-l` | `credsscrapper.log` | куди дописувати лог прогресу |

Зупинка (`Ctrl+C`) і повторний запуск тієї ж команди — безпечні: репозиторії
зі статусом `done` повторно не скануються.

### Паралельне сканування (`--workers`)

```bash
python -m app scan --db state.db --workdir workdir --workers 8
```

Клонування — це очікування на мережу/диск, а не навантаження на CPU, тому
кілька репозиторіїв можна обробляти одночасно без проблем з GIL. Кожен
потік відкриває власне з'єднання до `state.db`; SQLite працює в WAL-режимі
з `busy_timeout`, а `claim_next()` атомарний (`BEGIN IMMEDIATE`) — два
потоки ніколи не візьмуть один і той самий репозиторій в роботу.

## Послідовність запуску

1. `python -m app discover --db state.db` — наповнити чергу кандидатів.
2. `python -m app scan --db state.db --workdir workdir` — обробити чергу.
3. Повторювати `discover`/`scan` періодично (наприклад через cron) —
   стан накопичується в тому самому `state.db`.

Якщо `scan` пише `scanned 0 repos` — черга порожня, спочатку виконайте
`discover` (або перевірте, що `--db` вказує на той самий файл, куди
`discover` писав).

## Як перевірити, що знайшлось

```bash
# статус по кожному репозиторію
sqlite3 state.db "SELECT owner, name, status, last_commit_sha FROM scanned_repos;"

# скільки кандидатів ще чекає в черзі
sqlite3 state.db "SELECT status, COUNT(*) FROM candidates GROUP BY status;"

# самі знахідки
sqlite3 state.db "SELECT owner, name, file_path, commit_sha, secret_type, secret_value, line_number FROM findings;"

# зведення по типах секретів
sqlite3 state.db "SELECT secret_type, COUNT(*) FROM findings GROUP BY secret_type ORDER BY 2 DESC;"
```

`findings.secret_value` зараз зберігається як є, у відкритому вигляді
(свідоме рішення на етапі MVP для зручності відладки детектора — шифрування
буде додано перед будь-яким production-використанням).

## Тести

```bash
pytest -v
```

92 тести, без звернень до реальної мережі (GH Archive/GitHub) — усе на
локальних git-фікстурах.
