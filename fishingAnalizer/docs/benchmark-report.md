# Зведений звіт: розширення, Laya та Jev

Дата оновлення: 24 вересня 2026 року. Тут зібрано всі проведені вимірювання та перевірки. Виконувані тести залишаються в `test/`; цей файл зводить їхні результати, методику та межі висновків. Старі менші корпуси **не додаються** до 84 404 листів: між експериментами є перекриття і змінювалися поділи даних.

Поточні назви статусів у розширенні: **«Підозрілий»**, **«Зверніть увагу»**, **«Все ок»**. У збережених історичних таблицях `review` інколи названо «потрібна перевірка»; це невизначений автоматичний висновок, **не** перевірка листа командою. «Все ок» не гарантує безпеки.

## Швидкий підсумок

На однакових 51 447 тестових листах сирий вибір моделей, до серверних правил:

| Модель | Recall фішингу | Хибний «Підозрілий» серед ham | Строга точність | Медіана backend | Умови швидкості |
| --- | ---: | ---: | ---: | ---: | --- |
| Laya epoch 05 | 95,62% | 4,27% | 95,68% | 11,57 мс | Локальна RTX 5070 Ti, послідовно |
| Jev | 93,41% | 1,18% | 90,94% | 309 мс | OpenRouter, 20 одночасних запитів і ліміт стартів |

Це порівняння сирих моделей на тому самому тесті. Фінальні статуси Laya і Jev рахувалися з **різними версіями серверного правила**, тому їх не слід зіставляти як чисту різницю моделей. Jev додатково пройшов усі 84 404 листи: описове сумарне виявлення фішингу 95,11%, хибний червоний статус серед ham 1,28%, строга точність 90,38%; 79 фішингових листів отримали «Все ок». Відповіді API трьох повних прогонів коштували за `usage.cost` **$3,8980**, без малих пілотів і можливих витрат на таймаути. Сумарні метрики не є незалежним контрольним тестом, бо правило уточнювалося після перегляду основного тесту й валідації. Деталі — у [розділі Jev](#jev).

## Актуальні перевірки реалізації

- `npm test`: TypeScript typecheck, збірка, **41/41 Node-тест** і Python unittest (**25 виявлено, 7 пропущено за умовами системного Python, решта пройшли**). До додавання тестів відтворювача набір після виправлення нестабільного очікування додатково пройшов шість разів поспіль.
- Сценарії тестів охоплюють зчитування DOM, перемикання повідомлень, згоду, уникнення дубльованих запитів, відповідь backend і помилки без вердикту.
- Синтаксис `scripts/benchmark_jev.cjs` і `scripts/summarize_jev.py` перевірено; dry-run підтвердив 51 447 / 4 652 / 28 305 листів і `pending: 0` на всіх трьох поділах. Новий підсумковий скрипт відтворив контрольний JSON-звіт байт у байт.
- `localModel/.venv/bin/python -m unittest discover -s test -p '*_test.py' -v`: **25/25 пройшли** у поточній перевірці поза sandbox. Історичний реальний CUDA inference зараз повторно не запускався.

## Каталог автоматичних тестів

Нижче перелічено всі тести, які пройшли в останніх запусках; назви взято з фактичного TAP-виводу та verbose-виводу Python.

<details>
<summary>Node / TypeScript — 41 пройдений тест</summary>

**`test/background.test.ts` — 7**

- requires consent before fetching
- passes a valid response and rejects an upstream failure without a verdict
- rejects non-loopback server addresses
- network errors do not produce a verdict
- rejects a server verdict for another mode
- never sends mail after revocation even if an earlier grant finishes last
- fresh installation uses local Laya without an OpenRouter key

**`test/benchmark_jev.test.ts` — 3**

- replay updates an old backend status from the saved Jev choice without a provider call
- benchmark rejects a changed corpus even when its row count stays the same
- benchmark refuses saved choices without matching model and question provenance

**`test/bundle.test.ts` — 1**

- built content script works without globals and does not resend after its own DOM update

**`test/controller.test.ts` — 8**

- asks consent before transmission and sends one request per expanded message
- out-of-order response never appears on another or replaced message
- route change prevents a late verdict from appearing in the old thread
- pending analysis is not sent twice when result cache fills up
- mode change requires new consent and clears the old verdict
- revoked consent blocks an in-flight verdict
- changing the server blocks an in-flight verdict
- server error shows no verdict and can be retried once

**`test/dom.test.ts` — 3**

- reads each expanded Gmail message without copying hidden quoted text or HTML
- does not select collapsed messages, and switching the expanded message changes identity
- does not accept sender or attachment metadata forged inside email HTML

**`test/evaluate_core.test.ts` — 1**

- evaluation worker returns separate model/backend timings from one Laya request

**`test/panel.test.ts` — 1**

- panel replaces an error with a verdict and keeps mail text inert

**`test/server.test.ts` — 14**

- root explains that this address is the backend, not the extension UI
- Jev sends typed question to fixed OpenRouter URL and returns observed sign
- local adapter uses the same state/questions and rejects a non-loopback endpoint
- truncated text never gets a no-signals verdict
- a different link domain alone does not override a no-signals model answer
- a password request still promotes a no-signals model answer to review
- uncertain model decision stays distinct from suspicious and explains uncertainty
- preserves a suspicious model decision for a credential request without links
- upstream failures and malformed answers never produce a verdict
- rejects invalid requests before contacting model
- forwards only the agreed visible mail fields
- rejects a non-extension Origin on the health route
- health response identifies this backend for the launcher
- rejects malformed JSON without a verdict

**`test/settings.test.ts` — 3**

- accepts only a local backend root and preserves the consent key
- ignores malformed stored consents
- a late grant write cannot undo a later revocation

</details>

<details>
<summary>Python у середовищі Laya — 25 пройдених тестів</summary>

**`test/evaluate_local_test.py` — 2**

- `test_extracts_visible_html_and_href_without_attachment_content`
- `test_preflight_stops_when_local_model_returns_error`

**`test/large_eval_corpora_test.py` — 6**

- `test_curated_trec_csv_requires_verified_file_and_ham_count`
- `test_message_conversion_keeps_only_visible_fields`
- `test_phishing_pot_rejects_non_eml_and_oversize`
- `test_trec_2005_2006_numeric_paths_keep_only_ham`
- `test_trec_reads_index_last_without_loading_unindexed_spam`
- `test_trec_reads_only_indexed_ham_and_never_extracts_paths`

**`test/large_eval_metrics_test.py` — 6**

- `test_aggregate_output_never_contains_mail_fields`
- `test_base_identity_rejects_running_tuned_checkpoint`
- `test_empty_rates_are_json_null_and_intervals_are_bounded`
- `test_model_endpoint_stays_on_loopback_and_supports_alternate_port`
- `test_review_and_error_remain_in_denominators`
- `test_tuned_checkpoint_must_match_frozen_manifest`

**`test/large_eval_serve_test.py` — 4**

- `test_cuda_request_rejects_an_agent_that_landed_on_cpu`
- `test_invalid_checkpoint_fails_before_agent_load`
- `test_serves_existing_checkpoint_and_reports_only_identity`
- `test_wrong_weight_hash_fails_before_agent_load`

**`test/large_eval_split_test.py` — 3**

- `test_prepare_is_stable_and_prevents_cross_split_leakage`
- `test_split_policy_moves_trec07_only_when_needed`
- `test_when_trec_is_unavailable_ham_stays_in_each_split`

**`test/large_eval_training_test.py` — 4**

- `test_checkpoint_layout_contains_full_state`
- `test_frozen_encoder_and_changed_head`
- `test_resume_checks_weights_and_frozen_training_inputs`
- `test_training_question_matches_production_adapter`

</details>

Нижче наведені повні історичні результати. Їхні вказівки щодо старого правила `review` описують стан на час відповідного прогону, а не поточну поведінку розширення.


<a id="laya-base"></a>

## Початкова Laya: незмінені ваги, CPU та GPU

Новіші вимірювання з п'ятьма навченими checkpoint наведено в [розширеному бенчмарку](#laya-large). Цей документ зберігає початковий результат незмінених ваг.

Дата: 23 вересня 2026 року. Це відтворюваний тест **Laya Multilingual 0.3.11** та нашого backend, а не оцінка TypeSafe Jev. Ключ OpenRouter не налаштований, тому платних запитів до Jev не було.

### Дані та метод

Скрипт [`scripts/evaluate_local.py`](../scripts/evaluate_local.py) перетворює сирі MIME-листи на наближені до Gmail DOM поля: відправник, тема, видимий текст HTML або plain text, адреси посилань і назви вкладень. Він відкидає порожні й повторні листи, вибирає записи з фіксованим seed `20260923` і надсилає їх лише локальній Laya. Жодне посилання з листа не відкривається. `core` запускає справжню функцію backend `analyze()` та за **один** виклик Laya фіксує початковий вибір моделі й кінцевий статус після правил backend. Час одного запиту включає локальний HTTP, аналіз і обмін із тестовим процесом; завантаження корпусів і запуск моделі в медіану не входять.

| Корпус | Мітка | Унікальних листів у тесті | SHA-256 архіву/mbox |
| --- | --- | ---: | --- |
| [Nazario 2022](https://monkey.org/~jose/phishing/) | фішинг | 199 | `a6291e2cb990204766fce425423949b403cce4ae6a660fc8d08812e40a063fa7` |
| Nazario 2023 | фішинг | 380 | `5007f1c1dc91b15e93e988afa3a1cf402e15c88f765d3057be8bfec50dae1fe8` |
| Nazario 2024 | фішинг | 372 | `60afa40a2757170093a2bde31ec9cda4e54d33992203ce04bfbbc86d2e5e5b99` |
| Nazario 2025 | фішинг | 443 | `f1fa7e0fe35c9a16f36d9aa20ade7e1d3908d1d0c1d917b8c53c8aa799ec1c8f` |
| [SpamAssassin easy ham](https://spamassassin.apache.org/old/publiccorpus/readme.html) | звичайний | 2472 | `2b7b65904bcfcc31d2b5f51946f2d261370b257402cbbd62930b46ab83367438` |
| SpamAssassin hard ham | звичайний | 249 | `ce2ce67880643dbde65ea7f85bffbfe4417349c4bd80b6b0de56262ae6b0a9c9` |

Разом: **4115 листів**, із них 1394 фішингових та 2721 звичайний. Кеш корпусів лишається у `/tmp/fishing-eval-data`, а тексти не потрапляють у Git або звіт. Контрольна сума ваг `model.safetensors`: `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`, ревізія Hugging Face `aa8c91ca088ec597df95a0d1c76b3063cb2ae5e8`.

### Швидкість

Машина: AMD Ryzen AI 9 HX 370 (12 ядер/24 потоки), NVIDIA GeForce RTX 5070 Ti Laptop GPU (12 ГіБ VRAM), Node 22.23.1. Повний CPU-прогін був на Python 3.14.7 з PyTorch 2.14.0+cpu; повний GPU-прогін — на Python 3.13.14 з PyTorch 2.14.0+cu130. Щоб перевірити вплив цього розходження, окремо виміряно **ті самі 180 листів** на CPU та GPU в одному Python 3.13.14, з однаковими пакунками й вагами.

| Прогін, послідовні запити | Листів | Медіана | p95 | Увесь прогін | Помилки |
| --- | ---: | ---: | ---: | ---: | ---: |
| Повний CPU | 4115 | 263,5 мс | 638,0 мс | ≈30 хв 29 с | 0 |
| Повний GPU | 4115 | 12,6 мс | 22,1 мс | 61,7 с | 0 |
| Контрольний CPU, одне середовище | 180 | 246,8 мс | 708,7 мс | 66,5 с | 0 |
| Контрольний GPU, одне середовище | 180 | 13,6 мс | 24,3 мс | 7,5 с | 0 |

На контрольній вибірці GPU зменшила медіану приблизно **у 18,1 раза**. На всіх 4115 листах GPU обробила приблизно **66,7 листа/с** послідовно; під час роботи процес Laya займав близько **1,8 ГіБ VRAM**. Повний час включає парсинг корпусів; CPU ≈30 хв 29 с відновлено з часу створення та зміни файлу результату, тоді як решту тривалостей виміряв скрипт. Це теплі запити до однієї локальної моделі, без мережі до зовнішнього сервера, паралельних користувачів і часу першого завантаження ваг.

### Якість відповідей

Порядок у комірках: **підозрілий / потрібна перевірка / явних ознак не знайдено**. `review` — невизначений автоматичний статус, а не підтверджений успіх детектора.

| Метод і пристрій | Фішинг, 1394 | Звичайні, 2721 |
| --- | ---: | ---: |
| Сира відповідь Laya, CPU | 1358 / 19 / 17 | 1439 / 109 / 1173 |
| Backend після правил, CPU | 1358 / 30 / 6 | 1439 / 925 / 357 |
| Сира відповідь Laya, GPU | 1357 / 19 / 18 | 1434 / 115 / 1172 |
| Backend після правил, GPU | 1357 / 31 / 6 | 1434 / 933 / 354 |

На GPU кінцевий backend позначив підозрілими **97,3%** фішингових листів, але також **52,7%** звичайних. Це занадто багато хибних тривог для надійного фільтра. CPU/GPU змінили невелику частину відповідей, тому збіг не абсолютний. Правила backend переводять багато `no_signals` у `review`, якщо бачать додаткові ознаки або урізаний вміст; вони не усувають хибні `suspicious`.

| Корпус | CPU backend: підозрілий / перевірка / без ознак | GPU backend: підозрілий / перевірка / без ознак |
| --- | ---: | ---: |
| Phishing 2022 | 197 / 2 / 0 | 197 / 2 / 0 |
| Phishing 2023 | 369 / 11 / 0 | 368 / 12 / 0 |
| Phishing 2024 | 361 / 9 / 2 | 362 / 8 / 2 |
| Phishing 2025 | 431 / 8 / 4 | 430 / 9 / 4 |
| Easy ham | 1264 / 854 / 354 | 1258 / 863 / 351 |
| Hard ham | 175 / 71 / 3 | 176 / 70 / 3 |

### Інтеграція та повторення

Окремий HTTP-тест `--transport http --per-source 2` перевірив 12 листів через Laya й backend: **0 помилок**, медіана 12,7 мс для прямого запиту Laya та 16,6 мс для повного запиту backend. Цей режим викликає модель двічі на лист, тому його числа не слід порівнювати з повним `core` як однакове навантаження.

```bash
./start-all.sh
# В іншому терміналі:
python3 scripts/evaluate_local.py --download --all --transport core > /tmp/fishing-laya-evaluation.json
```

Для порівняння CPU/GPU зупиніть попередню Laya, запустіть відповідно `LAYA_DEVICE=cpu ./start-all.sh` або `LAYA_DEVICE=cuda ./start-all.sh` і повторіть тест з тим самим `--seed` та корпусами. Перед масовим тестом скрипт робить пробний аналіз і зупиняється, якщо модель не повернула коректний статус. `./start-all.sh` теж перевіряє аналіз синтетичного листа перед повідомленням про готовність. Повний текст листів не пишеться у звіт.

**Межі висновку.** Ці набори — не репрезентативна вибірка вашої Gmail-скриньки: звичайні листи здебільшого старіші за фішингові, джерела й мітки різні, а парсер MIME тільки наближає видимий Gmail DOM. Бракує українських листів, сучасних добрих листів, перевірки вкладень і заголовків SPF/DKIM. [Картка Laya Multilingual](https://huggingface.co/convaiinnovations/laya-multilingual) також застерігає щодо якості zero-shot typed decisions. Швидкість локальної GPU достатня для прототипу, але до оплати GPU-сервера потрібно виміряти реальну паралельність, вартість конкретного хостингу й TypeSafe Jev на тих самих листах. На час цього першого прогону ключ OpenRouter не був налаштований, тому порівняння з Jev тоді ще не проводилося.


<a id="laya-large"></a>

## Перший розширений бенчмарк Laya: п’ять епох

Дата: 24 вересня 2026 року. Це вимірювання локальної Laya Multilingual і правил нашого backend на публічних листах після перетворення MIME на видимі поля Gmail. TypeSafe Jev тут не викликався.

Це перший, менший експеримент. Пізніше оригінальні TREC-архіви знайшлися у публічних копіях; [новий звіт](#laya-trec) містить окремий тест на 51 447 листах. Поділи даних змінилися, тож наведені тут цифри не є прямим «до/після» для нового звіту.

### Дані та межі вибірки

Використано [оригінальні Nazario mbox](https://monkey.org/~jose/phishing/) 2005–2025 років ([умови CC BY 4.0](https://monkey.org/~jose/phishing/README.txt)), публічні 8 614 `.eml` із [Phishing Pot](https://github.com/rf-peixoto/phishing_pot) ([CC BY-NC 4.0](https://github.com/rf-peixoto/phishing_pot/blob/main/LICENSE), commit `49f63777126b0bdb9eb1f6e770a5c3f9df2b0306`) і три [SpamAssassin ham архіви](https://spamassassin.apache.org/old/publiccorpus/readme.html). Усі дані й контрольні точки лежать лише в ignored `localModel/.cache/`; повний текст, адреси та URL листів у Git або звіт не потрапляють. У Phishing Pot число 10 362 в README включає приватні зразки, тому ми його не використовуємо як кількість доступних листів. У комерційному дослідженні або продукті використання Phishing Pot потребує окремої перевірки прав.

Оригінальні посилання [TREC Spam Track](https://trec.nist.gov/data/spam.html) перенаправляють на недоступні нині архіви (HTTP 404). Авторські [TREC CSV на Zenodo](https://zenodo.org/records/8339691) були завантажені й мали заявлені MD5, але кількість рядків із `label=0` в них становила 32 329 / 12 411 / 24 358 для 2005 / 2006 / 2007, тоді як в оригінальних публікаціях TREC опубліковано 39 399 / 12 910 / 25 220 ham відповідно ([2005](https://trec.nist.gov/pubs/trec14/papers/SPAM.OVERVIEW.pdf), [2006](https://trec.nist.gov/pubs/trec15/papers/SPAM06.OVERVIEW.pdf), [2007](https://trec.nist.gov/pubs/trec16/papers/SPAM.OVERVIEW16.pdf)). CSV є переробленими, частина рядків має порожню мітку. Ми не включили їх до основного тесту як оригінальні TREC ham і не називали spam фішингом.

Після обмеження MIME розміру 256 КіБ, відкидання порожніх листів і точної/близької дедуплікації залишилося **15 460** листів. Відкинуто 369 порожніх і 5 048 повторів. Маніфест: SHA-256 `f90cc97e40e28f9b4fcc1d5d97287f4ed645aaa7c1a7393a3b71a3933f4a4eb4`; `seed=20260924`. Повні SHA-256 кожного джерела, ID і причини виключення є в локальному `localModel/.cache/evaluation/manifest.json`, який не містить текстів листів.

| Розділ | Фішинг | Звичайні | Разом | Джерела звичайних листів |
| --- | ---: | ---: | ---: | --- |
| Навчання | 4 248 | 2 470 | 6 718 | SpamAssassin easy_ham |
| Валідація | 554 | 1 388 | 1 942 | SpamAssassin easy_ham_2 |
| Недоторканий тест | 6 559 | 241 | 6 800 | SpamAssassin hard_ham |

У тесті 351 фішинговий лист Nazario 2024, 428 — Nazario 2025 і 5 780 — Phishing Pot. Позитивні листи навчання походять лише з Nazario до 2022 року; Phishing Pot не використовувався для налаштування ваг. Розділи розділено за роками/джерелами, а дублікати між ними видалено. Ціль 50–100 тисяч **не досягнута**: доступних листів із достатньо надійними мітками після очищення лише 15 460, з яких тестових 6 800. Особливо обмежена оцінка хибних тривог: вона спирається на 241 старий ham лист.

### Метод

База: незмінений checkpoint `convaiinnovations/laya` multilingual, SHA-256 ваг `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`, ревізія `aa8c91ca088ec597df95a0d1c76b3063cb2ae5e8`. П'ять ітерацій — п'ять послідовних епох PyTorch із замороженим encoder і навченими `head`, `type_emb`, `scorer`. Втрата зважена за двома класами, AdamW `lr=1e-4`, `weight_decay=0.01`, accumulation 8, gradient clipping 1, seed 20260924. Після кожної епохи збережено повний checkpoint; початкові ваги лишилися незмінними. П'ять версій оцінюються тільки на валідації. Критерій вибору checkpoint зафіксовано до відкриття тестових результатів: найбільша `backend balanced_accuracy`, при рівності — менший `ham_fpr`, потім раніша епоха. Базова і п'ята версія оцінюються на недоторканому тесті незалежно від вибору. П'яту оцінено двічі на тих самих листах; другий прогін не додає незалежної вибірки.

Обидва рішення на кожен лист отримані після **одного** запиту `/v1/systemone`: сирий тристатусний вибір Laya і кінцевий статус production `analyze()` після спостережуваних правил. `review` і помилки залишаються в знаменниках і не вважаються виявленим фішингом або безпечним ham. Strict accuracy рахує тільки `phishing→suspicious` і `ham→no_signals`. 95% інтервали — Wilson для часток. Медіана/p95 часу — послідовні теплі HTTP запити, без завантаження ваг/корпусів та без паралельних користувачів.

Обладнання: NVIDIA GeForce RTX 5070 Ti Laptop GPU, 12 227 MiB VRAM, драйвер 615.71.09; Python 3.13.14, PyTorch 2.14.0+cu130, CUDA 13.0, Laya 0.3.11.

### П'ять епох і валідація

У таблиці `recall` — частка phishing зі статусом `suspicious`; `FPR` — частка ham зі статусом `suspicious`; `specificity` — частка ham зі статусом `no_signals`. `review` лишається в знаменнику всіх цих часток. Наведено кінцевий статус backend для 554 phishing і 1 388 ham. Кожен прогін мав **0 помилок**.

| Ваги | Loss навчання | Recall | FPR ham | Specificity ham | Balanced accuracy | Review усіх | Медіана / p95 backend, мс |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| База | — | 97,65% | 50,94% | 2,23% | 49,94% | 34,14% | 12,74 / 20,61 |
| Epoch 01 | 0,1816 | 97,65% | 1,44% | 5,62% | 51,64% | 66,89% | 12,85 / 20,92 |
| **Epoch 02** | 0,0616 | **99,82%** | 1,51% | 5,26% | **52,54%** | 66,68% | 13,00 / 21,05 |
| Epoch 03 | 0,0453 | 99,64% | 1,51% | 5,26% | 52,45% | 66,74% | 12,89 / 20,75 |
| Epoch 04 | 0,0357 | 97,29% | 0,29% | 5,91% | 51,60% | 67,61% | 13,01 / 20,89 |
| Epoch 05 | 0,0237 | 99,46% | 0,72% | 5,55% | 52,50% | 67,15% | 12,96 / 21,08 |

За зафіксованим правилом обрано **epoch‑02**: її balanced accuracy backend на валідації 52,54%, проти 52,50% у epoch‑05. Це близькі значення, тому вибір нестійкий до іншої валідаційної вибірки. Файл `selection.json` із вибором, хешем маніфесту й SHA-256 усіх п'яти валідаційних агрегатів збережено в ignored кеші **до** відкриття `test`; його SHA-256 — `600f492fe0e2d4f3d80d138d0a9dc4b167a02261ca6bf29c95e6db4c26f6f829`.

Ваги всіх епох різні. SHA-256 `model.safetensors`: epoch‑01 `6cbd874793383d62359a939c1d4205db5de76664d2348c3b8e8effe2f96fd2fd`; epoch‑02 `289e899b07a6bbfd79f89d40849c0e907ade66557575fb269abd78d1f691f107`; epoch‑03 `c6ee5ce3440cc65f212a54c421d3ff9c5501c836e9ecc35336daac048f4a2cb3`; epoch‑04 `5539171ac47b33292745bdf119c10e263acd829701bc20d051c72b2edd2abe8b`; epoch‑05 `5a706e13d256cacbaa8a62901a0f4225ecede7636855854fe2c8f779e514840f`. Порівняння tensor-by-tensor підтвердило: усі **134** тензори encoder ідентичні базі, **31** тензор навчуваних частин epoch‑05 відрізняється. CUDA smoke test до навчання використав максимум 1 613 910 528 байтів виділеної пам'яті PyTorch і успішно перезавантажив синтетичний checkpoint.

### Недоторканий тест і повтор п'ятої версії

У тесті 6 559 phishing і лише 241 ham. Матриця нижче — **кількість листів** у порядку `suspicious / review / no_signals / error`. Сирий вибір Laya та відповідь backend зафіксовані одним запитом до моделі на лист.

| Ваги | Метод | Phishing: S / R / N / E | Ham: S / R / N / E |
| --- | --- | ---: | ---: |
| База | Laya | 6 383 / 84 / 92 / 0 | 168 / 13 / 60 / 0 |
| База | Backend | 6 383 / 145 / 31 / 0 | 168 / 70 / 3 / 0 |
| Обрана epoch‑02 | Laya | 6 499 / 6 / 54 / 0 | 51 / 0 / 190 / 0 |
| Обрана epoch‑02 | Backend | 6 499 / 39 / 21 / 0 | 53 / 173 / 15 / 0 |
| Epoch‑05 | Laya | 6 493 / 1 / 65 / 0 | 33 / 0 / 208 / 0 |
| Epoch‑05 | Backend | 6 493 / 51 / 15 / 0 | 35 / 189 / 17 / 0 |
| Epoch‑05, контроль | Laya | 6 493 / 1 / 65 / 0 | 33 / 0 / 208 / 0 |
| Epoch‑05, контроль | Backend | 6 493 / 51 / 15 / 0 | 35 / 189 / 17 / 0 |

Обидва прогони epoch‑05 використали **той самий хеш ваг і той самий маніфест**; усі комірки матриці збіглися. Це перевірка повторюваності, а не додаткові 6 800 незалежних листів. Epoch‑02 обрана за валідацією; те, що epoch‑05 має трохи вищу тестову balanced accuracy, **не є підставою переобрати її за результатом тесту**.

| Backend на test | Recall phishing | FPR ham | Precision | F1 | Balanced accuracy | Strict accuracy | Review усіх | Помилки |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| База | 97,32% | 69,71% | 97,44% | 97,38% | 49,28% | 93,91% | 3,16% | 0 |
| Обрана epoch‑02 | 99,09% | 21,99% | 99,19% | 99,14% | 52,65% | 95,79% | 3,12% | 0 |
| Epoch‑05 | 98,99% | 14,52% | 99,46% | 99,23% | 53,02% | 95,74% | 3,53% | 0 |
| Epoch‑05, контроль | 98,99% | 14,52% | 99,46% | 99,23% | 53,02% | 95,74% | 3,53% | 0 |

За Wilson 95%, recall backend: база **96,90–97,68%**, epoch‑02 **98,82–99,29%**, epoch‑05 **98,72–99,21%**. FPR ham: база **63,64–75,16%**, epoch‑02 **17,22–27,64%**, epoch‑05 **10,63–19,53%**. Ці інтервали припускають незалежні листи; схожі кампанії роблять їх потенційно надто вузькими навіть після дедуплікації. Тест на **96,46%** складається з phishing; тому precision і загальна strict accuracy виглядають високими навіть за слабкої роботи з ham. Наївне `suspicious` для кожного листа дало б 96,46% звичайної accuracy — більше за strict accuracy epoch‑05 (95,74%). Для цього завдання дивіться насамперед recall, FPR, `review` і їхні знаменники.

| Test, послідовні GPU запити | Laya медіана / p95, мс | Backend медіана / p95, мс | Весь прогін | Backend листів/с |
| --- | ---: | ---: | ---: | ---: |
| База | 12,98 / 21,77 | 13,24 / 22,12 | 100,73 с | 67,5 |
| Epoch‑02 | 12,86 / 21,28 | 13,12 / 21,68 | 99,27 с | 68,5 |
| Epoch‑05 | 12,89 / 21,27 | 13,16 / 21,62 | 99,37 с | 68,4 |
| Epoch‑05, контроль | 12,80 / 21,18 | 13,06 / 21,56 | 98,10 с | 69,3 |

Швидкість epoch‑05 лишилася близькою до базової на цій GPU. Це локальні послідовні запити без ціни хмарного GPU, мережі, завантаження ваг та паралельних користувачів. Під час бенчмарку окремий базовий процес Laya на порту 8000 лишався завантаженим у GPU; усі порівнювані прогони використовували власний сервер на порту 8010.

За джерелами тесту backend epoch‑05 позначила `suspicious` **348/351** Nazario 2024, **426/428** Nazario 2025 та **5 719/5 780** Phishing Pot. На складних звичайних листах SpamAssassin hard_ham позначила `suspicious` **35/241**, `review` **189/241**, `no_signals` лише **17/241**. Розходження з валідацією велике: на easy_ham_2 FPR epoch‑05 був 10/1 388 (0,72%), на hard_ham 35/241 (14,52%). Це свідчить про чутливість результату до типу звичайних листів.

Окремо від ваг, правило backend **на час цього прогону** переводило `no_signals` у `review`, коли була будь-яка спостережувана ознака або урізаний текст. Тому сирій Laya epoch‑05 вдалося дати `no_signals` для **208/241** ham, але в кінцевому інтерфейсі таких лишилося **17/241**. Навчальні дані містять тільки мітки phishing/ham, без окремого еталонного класу «потрібна перевірка», тому decision head навчався цілям `suspicious`/`no_signals`, а сирий `review` майже зник. Після навчання хибних червоних вердиктів значно менше, проте більшість складних звичайних листів усе ще отримувала невизначений статус. Міняти правило за цим test означало б підлаштуватися під контрольну вибірку; для нього потрібні нова валідація й новий test.

### Перевірки реалізації

| Перевірка | Результат |
| --- | --- |
| `npm test` | 35 Node-тестів пройшли; TypeScript typecheck і збірка пройшли. Системний Python: 22 тести, 6 пропущено через відсутність Laya/PyTorch. |
| `localModel/.venv/bin/python -m unittest discover -s test -p '*_test.py' -v` | Усі 22 Python-тести пройшли, включно з Laya/PyTorch, MIME, split, метриками, перевіркою checkpoint і GPU fallback. |
| Реальний CUDA smoke | Два синтетичні листи навчили head; checkpoint знову завантажився через Laya Agent. |
| Синтетичний end-to-end | Навчений checkpoint відповів через той самий production `analyze()`; інтерфейс `/v1/systemone` не змінено. |
| Реальні ваги epoch‑05 | Сервер завантажив checkpoint на CUDA; усі 134 encoder тензори лишилися незмінними, 31 навчуваний тензор змінився. |
| `npm run build`, `bash -n start-all.sh localModel/start.sh`, `git diff --check` | Пройшли. |

### Що означає результат

Корпуси не репрезентують сьогоднішню Gmail-пошту. Звичайні листи з 2003 року, фішингові з інших років і джерел; це зміщує оцінку. Парсер MIME лише наближає видимий Gmail DOM, а розширення не бачить SPF/DKIM, репутацію доменів або вміст вкладень. Якість на цих корпусах не є гарантією безпеки окремого листа. Через невелику кількість ham у тесті навіть значне зменшення false positive rate має широку невизначеність. Порівняння вартості GPU-сервера з Jev потребує окремого тесту Jev на тій самій вибірці та ціни конкретного хостингу; тут платних запитів немає.

### Хеші вхідних корпусів

`source_count` — записи, прийняті відповідним зчитувачем **до** відкидання порожніх і повторів. Для Phishing Pot SHA-256 обчислено від відсортованих відносних шляхів і SHA-256 `.eml`, для решти — від архіву/mbox. Усі URL джерел також є в локальному маніфесті.

| Джерело | Source count | SHA-256 |
| --- | ---: | --- |
| Nazario 2015 | 302 | `7523e62a5e6e4ee8134ab8b1a628e423097a7779e1003b28422864aa34f1c319` |
| Nazario 2016 | 489 | `42393e4d686193bfb879d1608c23fd4d3b698ccd4d73f0e1d2276ba709718483` |
| Nazario 2017 | 318 | `110fba876b38b44035bf065788952674bc68a7b6879c345a515a9ac844b1d704` |
| Nazario 2018 | 285 | `83f49cf2a76c7b29b205d22d8778e46848e36af0f15ee1df126a543696acd48d` |
| Nazario 2019 | 242 | `cab39d6fcb38cf80cdaabb3e6ffd1222777e2fcaac7e8480321b7f729c2e3c0e` |
| Nazario 2020 | 154 | `99e20bf25f5e8556d37103f2c8140cd75181a62d3df91df8acf9d9aece9f08bb` |
| Nazario 2021 | 99 | `636707cff42245d1482e4ae8a2c03369717a5e06bf9d1a0f4ec5dcd846661cee` |
| Nazario 2022 | 246 | `a6291e2cb990204766fce425423949b403cce4ae6a660fc8d08812e40a063fa7` |
| Nazario 2023 | 417 | `5007f1c1dc91b15e93e988afa3a1cf402e15c88f765d3057be8bfec50dae1fe8` |
| Nazario 2024 | 396 | `60afa40a2757170093a2bde31ec9cda4e54d33992203ce04bfbbc86d2e5e5b99` |
| Nazario 2025 | 472 | `f1fa7e0fe35c9a16f36d9aa20ade7e1d3908d1d0c1d917b8c53c8aa799ec1c8f` |
| Nazario 20051114.mbox | 437 | `928cbf1c394d01d0b398ded8dc7cbd94dd4ce9cb0d4efdecd12696338c247926` |
| Nazario phishing0.mbox | 414 | `6184b0a34ed8cbbb252676e21c1eab9eac5fa4be89c61e30cc9954ebbb25d848` |
| Nazario phishing1.mbox | 455 | `99f02474a11086408a5ce6d11ef38823f003c6611a4312c31fbee96773eeba28` |
| Nazario phishing2.mbox | 1 423 | `5113277984eae759a5ff958ccf408b542441ce033a49b923ab3b0f324075e6bd` |
| Nazario phishing3.mbox | 2 279 | `b29336d2e31c2dff19639415e98ed2aced5b4d63675ea5e29bea1a7d4e452841` |
| Phishing Pot | 8 300 | `f4b82939e4dd2b8477120e36492127fd9782bcfb6ed5f4a1a62c0dd933c7f49f` |
| SpamAssassin easy_ham | 2 500 | `2b7b65904bcfcc31d2b5f51946f2d261370b257402cbbd62930b46ab83367438` |
| SpamAssassin easy_ham_2 | 1 400 | `b4bd3dc5ae5b40f38e99a0e41ad7d16b428b56e818e3a6ffa07330d62004dd38` |
| SpamAssassin hard_ham | 249 | `ce2ce67880643dbde65ea7f85bffbfe4417349c4bd80b6b0de56262ae6b0a9c9` |


<a id="laya-trec"></a>

## Laya на оригінальних TREC-архівах

Дата: 24 вересня 2026 року. Це продовження [першого бенчмарку](#laya-large) на ширшій, заново зафіксованій вибірці. Його результати не слід порівнювати як «до/після» на тих самих листах: навчальний і тестовий поділи змінилися.

### Джерела й склад вибірки

Позитивний клас залишився таким самим: [оригінальні Nazario mbox](https://monkey.org/~jose/phishing/) та публічні `.eml` із [Phishing Pot](https://github.com/rf-peixoto/phishing_pot). Для негативного класу додано оригінальні TREC 2005–2007 архіви з [публічних копій](https://www.kaggle.com/datasets/bayes2003/emails-for-spam-or-ham-classification-trec-2005), [2006](https://www.kaggle.com/datasets/bayes2003/emails-for-spam-or-ham-classification-trec-2006), [2007](https://www.kaggle.com/datasets/bayes2003/emails-for-spam-or-ham-classification-trec-2007). [TREC Spam Track](https://trec.nist.gov/data/spam.html) є першоджерелом корпусів; старі прямі посилання на архіви зараз повертають HTTP 404. У кожному завантаженому архіві є `full/index` та файли вихідних листів. Для TREC 2005/2006 парсер читає `data/000/000`, для TREC 2007 — `data/inmail.1`. Він бере тільки записи `ham` з індексу. TREC `spam` **не** позначається як фішинг.

Первинні індекси містять 39 399, 12 910, 25 220 записів `ham` відповідно; це збігається з опублікованими числами ([2005](https://trec.nist.gov/pubs/trec14/papers/SPAM.OVERVIEW.pdf), [2006](https://trec.nist.gov/pubs/trec15/papers/SPAM06.OVERVIEW.pdf), [2007](https://trec.nist.gov/pubs/trec16/papers/SPAM.OVERVIEW16.pdf)). Після ліміту 256 КіБ на лист зчитувач прийняв 39 122 / 12 867 / 25 217. Перевірка архівів спирається на структуру та кількості індексів; незалежного офіційного SHA-256 для цих копій знайдено не було. SHA-256 завантажених оригінальних `.tgz`: `trec05p-1.tgz` — `7c4e5d589e4a887a667901b13c2a7559575f72c7608bcb7c47b2b12705e7aa19`; `trec06p.tgz` — `2186c0d66ae12332ad574a25bd3398820c57bff30bf7ca92802e6486da170c63`; `trec07p.tgz` — `af09464312bdfc67311db4d7b92bb9e6b10fbe5d93fd84ff92c38bd317e3c76c`.

Повні листи лежать тільки в Git-ігнорованому `localModel/.cache/`. Новий `manifest.json` має SHA-256 `d2e138bbcc5bc57f1590bb1aaa0ea5c3d9f85f619a3a94eb7912fa0b778b5da5`; він містить лише ідентифікатори-хеші, кількості та походження. Після перетворення MIME, відкидання 4 254 порожніх і видалення 9 425 повторів залишилося **84 404 унікальних листи**:

| Поділ | Фішинг | Ham | Разом | Ham-джерело |
| --- | ---: | ---: | ---: | --- |
| Навчання | 4 248 | 24 057 | 28 305 | TREC 2007 |
| Валідація | 554 | 4 098 | 4 652 | SpamAssassin |
| Недоторканий тест | 6 559 | 44 888 | **51 447** | TREC 2005/2006 |

У контрольному ham-класі 32 468 листів із TREC 2005 і 12 420 із TREC 2006. Навчання, валідація й тест поділені за джерелом/роком; точні та близькі повтори між ними вилучено. Це 51 447 **різних** тестових листів, а не 50 тисяч фішингових листів. Частка ham у тесті — 87,25%; тому звичайну accuracy й precision потрібно читати разом із recall, false positive rate, `review` та знаменниками.

### Протокол

Модель — Laya Multilingual, inference через той самий `/v1/systemone` і production backend, що й у [першому бенчмарку](#laya-large). Навчаються лише decision head, `type_emb`, `scorer`, encoder заморожений. П'ять послідовних епох із окремими checkpoint; seed `20260924`, AdamW `lr=1e-4`, `weight_decay=0.01`, gradient accumulation 8, зважування двох класів. Після epoch 02 ноутбук було перезавантажено. Ваги epoch 02 пройшли перевірку хешів, і epoch 03–05 продовжили їх навчання; стан AdamW у checkpoint не зберігався, тому його моменти було скинуто перед epoch 03. Це частина протоколу цього прогону, а не точне продовження стану оптимізатора. Кожна епоха оцінюється на валідації; checkpoint обирається **до** відкриття тесту за найбільшою backend balanced accuracy, при рівності — меншим ham FPR, далі ранішою епохою. На тесті незалежно від вибору оцінюються база й epoch 05, а epoch 05 запускається двічі для перевірки повторюваності. Повтор не додає нових листів. `review` і помилки залишаються в знаменниках. Пороги та правила backend за тестом не переналаштовуються.

Вимірювання — послідовні теплі HTTP-запити на NVIDIA GeForce RTX 5070 Ti Laptop GPU 12 227 MiB. Затримка не включає час запуску процесу й завантаження ваг. Вартість хмарного GPU та платний Jev тут не вимірюються.

### Валідація та вибір

У таблиці `recall` — phishing → `suspicious`, FPR — ham → `suspicious`, `specificity` — ham → `no_signals`. Стани `review` і помилки лишаються у знаменниках. Це кінцеві вердикти backend після правил, а не лише сирі відповіді Laya. На кожен лист робиться один запит до моделі.

| Ваги | Loss навчання | Recall | Ham FPR | Ham specificity | Balanced accuracy | Review усіх | Медіана / p95 backend, мс |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| База | — | 97,65% | 52,05% | 9,39% | 53,52% | 34,24% | 12,30 / 20,11 |
| Epoch 01 | 0,1833 | 93,50% | 0,46% | 16,62% | 55,06% | 73,50% | 12,33 / 20,36 |
| Epoch 02 | 0,0748 | 94,58% | 0,51% | 16,62% | 55,60% | 73,37% | 12,25 / 20,37 |
| Epoch 03 | 0,0571 | 96,93% | 0,76% | 16,50% | 56,71% | 73,09% | 12,40 / 20,44 |
| Epoch 04 | 0,0400 | 91,88% | 0,32% | 16,69% | 54,28% | 73,65% | 12,34 / 20,47 |
| **Epoch 05** | 0,0357 | **97,47%** | 0,54% | 16,62% | **57,05%** | 73,13% | 12,32 / 20,28 |

На всіх шести прогонах по 4 652 листи було **0 помилок**. За наперед визначеним критерієм обрано epoch 05. Її вибір та SHA-256 п'яти валідаційних звітів записано в Git-ігнорований `selection.json` **до** першого тестового запиту; SHA-256 файлу вибору `6eacfc0cddb48fa797aff79d471cabfea5e22b1393d16de7e886fc262a4a1892`. Зменшення FPR супроводжується переведенням більшості ham у `review`, тому це ще не розв'язана задача трьох станів.

SHA-256 ваг по епохах: 01 — `f099e13355cd4b4b9ab450b30d28faaa07bd5aa624b1dabfe99a6190fce34a64`; 02 — `34c18315a863b5ccef038ba446964d040abe35b0391743badd94fbbdb6da2960`; 03 — `e7e2f11aa1be640295670ad0e0f9f999de1218142067139d05f2ddfcc5e3060f`; 04 — `83600a5809516bf24299a5ffc96bc4f458e98f5917a69333cd1fd7abc2afb60c`; 05 — `5a382094e19ffaf51a88ef90606b307969b8d89a6189e3314137285b4d483274`.

### Як читати тест

`Suspicious` — позитивний прогноз, `no_signals` — негативний, `review` — невизначений. Фішинговий лист у `review` **не** рахується виявленим; ham у `review` **не** рахується правильно очищеним. Recall = підозрілі фішингові / усі фішингові; FPR = підозрілі ham / усі ham; specificity = ham без ознак / усі ham. Balanced accuracy тут дорівнює середньому recall і specificity, тож велика частка `review` його знижує. Precision — частка справжнього фішингу серед усіх `suspicious` у **цьому конкретному** тесті; вона залежить від частки класів. Нуль помилок означає, що всі запити завершилися відповіддю, а не що всі вердикти правильні.

### Недоторканий тест: 51 447 листів

У кожному рядку тесту знаменники однакові: **6 559 фішингових** і **44 888 ham**. На одному листі зберігалися сирий вердикт Laya та кінцевий вердикт backend, без другого запиту до моделі. Позначення в матрицях: `S` — підозрілий, `R` — потрібна перевірка, `N` — явних ознак не знайдено, `E` — помилка; порядок чисел `S / R / N / E`.

| Ваги й спосіб оцінки | Фішинг: S / R / N / E | Ham: S / R / N / E |
| --- | ---: | ---: |
| База, сира Laya | 6 383 / 84 / 92 / 0 | 15 221 / 11 024 / 18 643 / 0 |
| База, фінальний backend | 6 383 / 145 / 31 / 0 | 15 236 / 12 998 / 16 654 / 0 |
| Epoch 05, сира Laya | 6 272 / 0 / 287 / 0 | 1 918 / 18 / 42 952 / 0 |
| **Epoch 05, фінальний backend** | **6 280 / 200 / 79 / 0** | **1 963 / 6 522 / 36 403 / 0** |
| Epoch 05, контрольний повтор backend | 6 280 / 200 / 79 / 0 | 1 963 / 6 522 / 36 403 / 0 |

| Ваги й спосіб | Recall фішингу | Ham FPR | Ham specificity | Precision | F1 | Balanced accuracy | Strict accuracy | Review усіх | Помилки |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| База, сира Laya | 97,32% | 33,91% | 41,53% | 29,55% | 45,33% | 69,42% | 48,64% | 21,59% | 0 |
| База, фінальний backend | 97,32% | 33,94% | 37,10% | 29,52% | 45,30% | 67,21% | 44,78% | 25,55% | 0 |
| Epoch 05, сира Laya | 95,62% | 4,27% | 95,69% | 76,58% | 85,05% | 95,66% | 95,68% | 0,03% | 0 |
| **Epoch 05, фінальний backend** | **95,75%** | **4,37%** | **81,10%** | **76,19%** | **84,85%** | **88,42%** | **82,96%** | **13,07%** | **0** |
| Epoch 05, контрольний повтор backend | 95,75% | 4,37% | 81,10% | 76,19% | 84,85% | 88,42% | 82,96% | 13,07% | 0 |

Для фінального backend epoch 05 інтервал Вілсона 95%: recall фішингу **95,23–96,21%**, ham FPR **4,19–4,57%**, ham specificity **80,73–81,46%**, precision **75,25–77,09%**. Ці інтервали описують вибіркову невизначеність за умови незалежних прикладів; вони не усувають зміщення джерел або помилок міток. Зокрема, **79 фішингових листів отримали `no_signals`**, а ще 200 — `review`. Серед ham **1 963** помилково позначено підозрілими і **6 522** отримали невизначений статус. Порівняно з базою FPR впав із 33,94% до 4,37%, але recall знизився з 97,32% до 95,75%; це компроміс, а не безумовне поліпшення кожного показника.

Зріз за джерелом для фінального backend epoch 05: Nazario 2024 — 340/351 фішингових позначені `suspicious` (96,87%); Nazario 2025 — 423/428 (98,83%); Phishing Pot — 5 517/5 780 (95,45%). TREC 2005: 1 589/32 468 ham помилково `suspicious` (4,89%); TREC 2006: 374/12 420 (3,01%). Змішані джерела та різні роки можуть спрощувати задачу порівняно з реальним потоком Gmail.

### Швидкість і повторюваність

| Тестовий прогін | Час на 51 447 листів | Пропускна здатність | Медіана / p95 сирої Laya, мс | Медіана / p95 backend, мс |
| --- | ---: | ---: | ---: | ---: |
| База | 677,85 с | 75,90 листа/с | 11,47 / 19,94 | 11,70 / 20,24 |
| Epoch 05, перший | 671,98 с | 76,56 листа/с | 11,33 / 19,89 | 11,57 / 20,18 |
| Epoch 05, контрольний | 684,53 с | 75,16 листа/с | 11,57 / 20,33 | 11,80 / 20,63 |

Контрольний прогін використав той самий manifest, код адаптера, checkpoint і 51 447 листів. Усі чотири матриці для сирої Laya та фінального backend **збіглися точно** між двома запусками epoch 05; час відповіді дещо коливався. Це перевірка відтворюваності inference на цій машині, а не незалежна валідація точності. Швидкості виміряні послідовними запитами на локальній ноутбучній RTX 5070 Ti; вони не прогнозують ціну чи швидкість хмарного GPU або платного Jev. Навчено decision head; велика частина ваг encoder залишилася незмінною.

### Перевірки коду

`npm test` і `npm run build` виконані успішно: 35 тестів Node та збірка TypeScript. Повний Python набір у віртуальному середовищі Laya — **25/25** успішно. Нові тести перевіряють шляхові формати TREC 2005/2006, вибір лише індексованого ham, потокове зчитування та перевірку checkpoint перед продовженням. `git diff --check` не виявив помилок форматування. У sandbox локальні HTTP-сокети заборонені (`listen EPERM`), тому інтеграційні тести й GPU-бенчмарк виконувалися поза ним із дозволом середовища.

### Обмеження

TREC ham походить із 2005–2007 років, тому не репрезентує сучасний Gmail. [Опис TREC 2005](https://trec.nist.gov/pubs/trec14/papers/SPAM.OVERVIEW.pdf) визначає мітки для задачі **spam/ham**, а не окрему перевірку на всі види фішингу. Позитивні листи з Nazario та Phishing Pot походять з інших джерел, що створює джерельне зміщення. HTML/MIME парсер лише наближає текст і посилання, видимі в Gmail DOM. Розширення не бачить SPF/DKIM, репутацію домену та вміст вкладень. Висновок моделі не гарантує безпеку окремого листа.

Інші знайдені набори не додано до основної оцінки: [MeAJOR](https://pmc.ncbi.nlm.nih.gov/articles/PMC13080633/) переробляє переважно ті самі TREC та маскує сутності й URL, тому призвів би до перекриття джерел і втрати важливих для Gmail сигналів; [EPVME](https://github.com/sunknighteric/EPVME-Dataset/) генерує варіанти атак на заголовки, підписи й MIME та бере частину текстів зі старих корпусів. Вважати їх новими незалежними реальними фішинговими листами було б помилкою.


<a id="jev"></a>

## Jev на всьому корпусі

Дата: 24 вересня 2026 року. Модель `typesafe/jev-1.13` викликалася через OpenRouter Decisions API з тим самим тристатусним запитанням, яке використовує backend. Це вимірювання прототипу, а не гарантія безпеки окремого листа.

### Дані та протокол

Перевірено **всі 84 404 унікальні листи** підготовленого корпусу. Основний тест — 51 447 листів: 6 559 phishing із Nazario 2024/2025 та Phishing Pot, 44 888 ham із TREC 2005/2006. Валідація — 4 652 листи: 554 phishing із Nazario 2022/2023 та 4 098 ham із SpamAssassin. Контрольний набір — 28 305 листів: 4 248 phishing із ранніх Nazario до 2021 року й 24 057 ham із TREC 2007. Це ті самі підготовлені поділи, що описані у [звіті Laya](#laya-trec); SHA-256 їхнього manifest — `d2e138bbcc5bc57f1590bb1aaa0ea5c3d9f85f619a3a94eb7912fa0b778b5da5`.

Спочатку записувався сирий вибір Jev (`suspicious`, `review`, `no_signals`), потім production backend застосовував спостережувані ознаки. Видима адреса посилання, яка веде на інший домен, переводить лист у `suspicious`. Запит пароля чи коду та скорочений текст можуть перевести `no_signals` у `review`. Сам по собі інший домен посилання показується користувачу, але не переважує `no_signals`: таке посилання часто нормальне. У плагіні ці стани називаються «Підозрілий», «Зверніть увагу», «Все ок». Помилка API не є вердиктом.

Остаточне правило для `review` було уточнене **після перегляду** основного тесту й валідації. Їхні фінальні статуси перераховані локально через актуальну функцію backend на збережених виборах Jev; листи повторно до OpenRouter не надсилалися. Тому ці два підсумки є **дослідницькими**, а не незалежною оцінкою вже обраного правила. Контрольний набір не використовувався для цього уточнення правила. Однак саме на ньому навчалися ваги Laya, тому порівнювати Laya та Jev за його результатами не можна.

Публічні тексти листів передавалися до OpenRouter за дозволом користувача. У локальних результатах зберігалися тільки метадані: хеш-ідентифікатор, джерело, мітка, сирий вибір Jev, підсумковий статус, HTTP-код, час, кількість токенів і вартість. Корпус і результати лежать у Git-ігнорованому `.cache/`; тексти не копіювалися у файл результатів або звіт. Ключ OpenRouter використовувався лише в локальних серверних процесах із `.env` і не потрапляв до розширення чи звіту.

### Результати повного корпусу

Порядок у матриці: **Підозрілий / Зверніть увагу / Все ок / Помилка**.

| Прогін і клас | Підозрілий | Зверніть увагу | Все ок | Помилка |
| --- | ---: | ---: | ---: | ---: |
| Основний тест: phishing, 6 559 | 6 134 | 370 | 55 | 0 |
| Основний тест: ham, 44 888 | 576 | 4 588 | 39 724 | 0 |
| Валідація: phishing, 554 | 533 | 21 | 0 | 0 |
| Валідація: ham, 4 098 | 78 | 329 | 3 691 | 0 |
| Контроль: phishing, 4 248 | 4 139 | 85 | 24 | 0 |
| Контроль: ham, 24 057 | 283 | 1 713 | 22 061 | 0 |
| **Разом: phishing, 11 361** | **10 806** | **476** | **79** | **0** |
| **Разом: ham, 73 043** | **937** | **6 630** | **65 476** | **0** |

| Метрика | Основний тест | Валідація | Контроль | Разом² |
| --- | ---: | ---: | ---: | ---: |
| Виявлення phishing як «Підозрілий» (recall) | 93,52% | 96,21% | 97,43% | 95,11% |
| Хибний «Підозрілий» серед ham (FPR) | 1,28% | 1,90% | 1,18% | 1,28% |
| Ham зі статусом «Все ок» (specificity) | 88,50% | 90,07% | 91,70% | 89,64% |
| Precision серед «Підозрілий» | 91,42% | 87,23% | 93,60% | 92,02% |
| F1 | 92,46% | 91,50% | 95,48% | 93,54% |
| Строга точність¹ | 89,14% | 90,80% | 92,56% | 90,38% |
| «Зверніть увагу» серед усіх | 9,64% | 7,52% | 6,35% | 8,42% |

¹ Строга точність рахує влученнями лише `phishing → suspicious` і `ham → no_signals`; `review` не вважається влученням. ² Стовпець «Разом» — описова сума, **не незалежна контрольна оцінка**, бо правило статусу уточнювалося за основним тестом і валідацією. На основному тесті 95% інтервал Вілсона для recall — **92,90–94,09%**, для ham FPR — **1,18–1,39%**; на контрольному — відповідно **96,91–97,87%** і **1,05–1,32%**. На всьому корпусі **79 фішингових листів отримали «Все ок»**, а 476 — «Зверніть увагу». Це матеріальний ризик, навіть за високої середньої точності.

Зріз за джерелом в основному тесті: Nazario 2024 — 326 / 19 / 6 phishing; Nazario 2025 — 399 / 25 / 4; Phishing Pot — 5 409 / 326 / 45. Для ham TREC 2005 — 480 / 4 183 / 27 805, TREC 2006 — 96 / 405 / 11 919. На складнішому SpamAssassin hard ham у валідації 45 із 240 листів отримали «Підозрілий», 124 — «Зверніть увагу», 71 — «Все ок»; загальні відсотки приховують цю слабкість.

### Сирий Jev і порівняння з Laya

На однакових 51 447 тестових листах сирий Jev (до правил backend) дав phishing **6 127 / 372 / 60**, ham **531 / 3 698 / 40 659**. Порівняння із сирою навченою Laya epoch 05 з [раніше зафіксованого бенчмарку](#laya-trec):

| Сира модель, ті самі листи | Recall phishing | Хибний «Підозрілий» серед ham | Ham «Все ок» | Строга точність |
| --- | ---: | ---: | ---: | ---: |
| Jev | 93,41% | 1,18% | 90,58% | 90,94% |
| Laya epoch 05 | 95,62% | 4,27% | 95,69% | 95,68% |

Jev робив менше хибних червоних вердиктів, але частіше залишав результат невизначеним і дещо рідше позначав phishing як підозрілий. Попередні **фінальні** цифри Laya отримані зі старим правилом backend, тому порівнювати їх напряму з оновленими фінальними цифрами Jev некоректно. За швидкістю локальна Laya на RTX 5070 Ti мала медіану backend **11,57 мс** і **76,56 листа/с** у послідовному GPU-тесті; Jev мав **309 мс** і **18,18 листа/с** у мережевому тесті з нашим лімітом стартів, а в короткому синтетичному сплеску — **55,94 листа/с**. Це різні режими навантаження й обладнання, тому вони не доводять граничну продуктивність хмарного Jev або AWS GPU.

### Швидкість, збої та гроші

| Прогін | Листів | Час | Темп | Медіана / p95 / p99 backend | Вхідні токени | Вартість відповідей API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Основний тест | 51 447 | 2 830 с (47 хв 10 с) | 18,18 листа/с | 309 / 437 / 685 мс | 51 413 207 | $2,1594 |
| Валідація | 4 652 | 256,3 с (4 хв 16 с) | 18,15 листа/с | 324 / 614 / 1 043 мс | 4 883 912 | $0,2051 |
| Контроль | 28 305 | 1 784,3 с (29 хв 44 с) з повтором | 15,86 листа/с | 455 / 2 198 / 2 787 мс | 36 513 042 | $1,5335 |
| **Увесь корпус** | **84 404** | **≈81 хв 10 с** | **≈17,33 листа/с** | — | **92 810 161** | **$3,8980** |

У клієнта було 20 одночасних запитів і пауза 55 мс між стартами. **18 листів/с — встановлене нами обмеження темпу, а не доведена максимальна пропускна здатність Jev.** Затримки виміряні під час первинних живих запитів; після зміни простого локального правила статуси основного тесту й валідації були перераховані без нового мережевого вимірювання. У першому основному прогоні 1 із 51 447 запитів перевищив наш 20-секундний таймаут; повтор цього листа завершився успішно за 1,1 с. У контрольному прогоні технічно не завершилися 12 із 28 305 запитів: 10 відповідей HTTP 529 від OpenRouter і 2 таймаути; окремий повтор усіх 12 завершився успішно. У кінцевій матриці помилок немає, але ці збої важливі для експлуатації. Повторний час включено в час контролю, а первинні помилки — ні в latency-перцентилі успішних відповідей.

Окремий короткий тест **200 синтетичних листів** без паузи між стартами, з 20 одночасними запитами, завершився за **3,58 с: 55,94 листа/с**, HTTP 200 у всіх 200 випадках. Медіана / p95 / p99 — **310 / 458 / 503 мс**, 157 090 вхідних токенів, **$0,0066**. Синтетичні листи були коротшими й однаковими за формою; це оцінка короткого сплеску, **не гарантія тривалого темпу на реальній пошті**. Контрольний прогін із довшими листами та випадками HTTP 529 показав, що затримка може бути суттєво більшою.

Вартість — сума поля `usage.cost` в успішних відповідях, а не незалежно звірений баланс облікового запису. Сума трьох повних прогонів і короткого сплеску — **$3,9046**; додаткові малі пілоти в цю суму не входять. Таймаути могли мати невідому додаткову вартість.

### Як відтворити

Завантажте джерела зі [звіту Laya](#laya-trec) у `localModel/.cache/corpora/` за структурою, описаною в [README](../README.md). Підготуйте поділи командою `python3 -m scripts.large_eval.prepare --data-dir localModel/.cache/corpora --out-dir localModel/.cache/evaluation-trec-original` і звірте SHA-256 `manifest.json` з наведеним вище. У `fishingAnalizer/.env` задайте `OPENROUTER_API_KEY`, тоді з каталогу `fishingAnalizer` виконайте:

```bash
npm run build
node scripts/benchmark_jev.cjs test --dry-run
node scripts/benchmark_jev.cjs test
node scripts/benchmark_jev.cjs validation
node scripts/benchmark_jev.cjs train
PYTHONPATH=. python3 scripts/summarize_jev.py localModel/.cache/jev-final-test-results.jsonl > localModel/.cache/jev-final-test-summary.json
```

Для `validation` і `train` підставте в останній команді `jev-final-validation-results.jsonl` і `jev-final-train-results.jsonl`. Скрипт звіряє SHA-256 усього корпусу, модель і точний текст запитання; інший корпус або запитання зупиняє прогін. Сирі відповіді зберігаються у `jev-full-results.jsonl`, `jev-validation-results.jsonl`, `jev-train-results.jsonl` разом із Git-ігнорованим sidecar `*.meta.json`, який фіксує корпус, модель і запитання. **Сирий кеш без відповідного sidecar не приймається.** Для нового корпусу sidecar створюється автоматично перед запитами; наявний історичний кеш на цьому комп’ютері було звірено з первинним runner і хешами корпусів перед одноразовим створенням sidecar. При повторному запуску платні запити робляться тільки для відсутніх або помилкових листів, а **всі фінальні статуси перераховуються локально** через поточний backend у `jev-final-*.jsonl`. На вже повному корпусі це перевірено без нових запитів: повторені підсумки всіх трьох поділів точно збіглися з наведеними вище. Після технічних збоїв повторіть команду відповідного поділу й переконайтеся, що у зведенні `status.matrix` немає `error`. Ліміти витрат на один поділ: $15 / $2 / $5; зупинка через ліміт повертає ненульовий код.

### Межі висновку

TREC і SpamAssassin містять старі `ham`-листи з міткою «не спам», що не доводить відсутності будь-якого фішингу. Позитивні листи з інших джерел і років, тож джерельне зміщення може спрощувати класифікацію. Невідомо, чи публічні приклади входили до даних навчання Jev. Перетворення MIME лише наближає те, що бачить розширення в Gmail DOM; SPF/DKIM, репутацію домену й вміст вкладень прототип не аналізує. Precision у реальній пошті зміниться разом із часткою фішингу. «Все ок» означає тільки відсутність явних ознак у доступних полях, **не гарантію безпеки**.
