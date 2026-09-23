# Локальна Laya

`setup.sh` встановлює Laya у `.venv/` всередині цієї теки. `start.sh` запускає її HTTP сервер на `127.0.0.1:8000` і зберігає завантажені ваги у `.cache/huggingface/` тут же. Обидва каталоги не потрапляють до Git.

З кореня `fishingAnalizer`:

```bash
bash localModel/setup.sh
bash localModel/start.sh
```

Перший запуск завантажує модель і потребує мережі; наступні використовують локальні ваги. Цей процес потрібний лише для режиму Laya. Розширення звертається до Node backend на порту `8787`, а backend звертається до Laya на порту `8000`.

## Навчання decision head

Вхідні `train.jsonl` і `manifest.json` готує `scripts/large_eval/prepare.py` у `localModel/.cache/evaluation/`. П'ять епох навчають лише decision head, `type_emb` і `scorer`; encoder залишається замороженим. Потрібна CUDA. Спочатку перевірте GPU на двох синтетичних листах:

```bash
localModel/.venv/bin/python -m localModel.train_head --smoke
localModel/.venv/bin/python -m localModel.train_head \
  --data-dir localModel/.cache/evaluation \
  --out-dir localModel/.cache/checkpoints
```

Контрольні точки лежать у `.cache/checkpoints/epoch-01` … `epoch-05` разом із SHA-256 і параметрами навчання. Кеш, ваги та повні листи не комітяться і не виводяться в журнал. Повторний запуск із тим самим каталогом контрольних точок зупиниться, щоб не перезаписати попередній експеримент.

Для перевірки навченої версії запустіть її через той самий локальний API:

```bash
LAYA_CHECKPOINT="$(pwd)/localModel/.cache/checkpoints/epoch-05" bash start-all.sh
```

Без `LAYA_CHECKPOINT` працює базова Laya. Запущений сервер повертає тільки ідентичність ваг на `/checkpoint`; якщо порт `8000` уже зайнятий іншою версією, `start-all.sh` зупиниться з поясненням.
