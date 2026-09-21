# MyMalvare

- [`credsScrapper`](credsScrapper/README.md) — NestJS API та Next.js UI для
  виявлення витоків секретів у Git-репозиторіях.

## Робота з Codex

Відкривай цю теку як проєкт у Codex. Загальні правила — в
[`AGENTS.md`](AGENTS.md), правила основного застосунку — в
[`credsScrapper/AGENTS.md`](credsScrapper/AGENTS.md).

У [`.agents/skills/`](.agents/skills/) перенесено п'ять локальних навичок:
`new-use-case`, `add-scan-pattern`, `hex-architecture-reviewer`,
`secret-handling-reviewer`, `lazy-simplifier`. Вони охоплюють реалізацію та
рев'ю без залежності від Claude Code чи ponytail. Їх можна викликати за
назвою, наприклад `$new-use-case`, або попросити прочитати відповідний
`SKILL.md`. Почни нову сесію Codex після додавання навичок, щоб оновити їх
виявлення; у поточній сесії доступне пряме читання файлів.

Колишній hook форматування та TypeScript-перевірки замінено явним кроком
у `credsScrapper/AGENTS.md`; автоматичного запуску після кожного редагування
немає. Старі `.claude/` та `CLAUDE.md` видалено після перенесення правил.
Додаткові плагіни для міграції не потрібні.

Формати звірено з офіційними інструкціями OpenAI:
[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) та
[навички](https://learn.chatgpt.com/docs/build-skills).

Команди npm виконуй із відповідного підпроєкту: у корені немає
`package.json`. Деталі запуску — в README кожного підпроєкту; актуальні
команди та залежності перевіряй за його `package.json`.

Проєктний скіл [`push`](.agents/skills/push/SKILL.md), показаний як `/push`,
публікує зміни поточної задачі: нова гілка `codex/...` від щойно отриманого
remote `main`, перевірки, commit, push і PR у `main`, потім короткий звіт.
Явний виклик `$push` дозволяє весь цей процес; злиття PR до нього не входить.

## Аналіз і швидкодія credsScrapper

[Огляд логіки та прогалин](docs/reviews/2026-09-21-credsScrapper.md) і
[реалізовані оптимізації з графіками до/після](docs/benchmarks/2026-09-21-scan-performance.md).
У звіті наведено методику вимірювання, межі перевірки та порівняння
bare clone, архівів і кешу для повторних сканувань.

Постійний кеш та інкрементальний режим уже реалізовано:
[повторні сканування, тести й заміри](docs/benchmarks/2026-09-21-incremental-performance.md).
