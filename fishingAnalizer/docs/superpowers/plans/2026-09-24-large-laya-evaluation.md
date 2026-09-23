# Large Laya Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Провести відтворюваний бенчмарк Laya Multilingual на цільовій контрольній вибірці 50–100 тисяч листів, навчити п'ять послідовних версій decision head і повторно перевірити п'яту.

**Architecture:** Публічні корпуси конвертуються в локальні JSONL із формою `MailMessage`; окремий маніфест містить лише геші й походження. Навчання зберігає п'ять повних сумісних checkpoint, а наявний backend оцінює їх через той самий `/v1/systemone`, що використовує розширення. Підсумковий звіт формується з агрегатів і не містить листів.

**Tech Stack:** Python 3.13, PyTorch 2.14 + CUDA, Laya 0.3.11, safetensors, стандартна бібліотека Python, чинні Node/TypeScript backend і `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-24-large-laya-evaluation-design.md`

## Global Constraints

- Основний позитивний клас: доступні публічні Nazario та Phishing Pot; TREC `spam` ніколи не стає фішингом.
- Основний негативний клас: лише TREC `ham` і SpamAssassin ham.
- Фінальний `test` фіксується до навчання; жоден його показник не впливає на ваги, пороги або вибір checkpoint.
- П'ять ітерацій — п'ять епох зі зміненими вагами й окремими checkpoint; п'ятий checkpoint оцінюється на `test` двічі.
- Повні листи й ваги залишаються в `localModel/.cache/evaluation/` та `localModel/.cache/checkpoints/`, які ігнорує Git. У stdout/stderr і Git потрапляють лише агрегати, геші та синтетичні приклади.
- Запити до URL із листів, виконання HTML, відкривання вкладень, Gmail API й платні запити до Jev заборонені.
- Якщо справжній `test` не досягає 50 000 унікальних листів, звіт указує фактичну кількість; дані не множаться штучно.

## Review Focus

- TREC-архів містить `spam` та `ham` з однаковими номерами: тест у Task 1 доводить, що виводиться лише `ham` із `full/index`.
- Два джерела містять той самий або майже той самий лист: тест у Task 2 доводить, що він не лишається в різних split.
- Пошкоджений MIME або HTML зі скриптом/прихованим блоком: тест у Task 1 доводить, що скрипт не виконується й прихований текст не стає полем листа.
- Модель повернула `review` або помилку: тест у Task 3 доводить, що це не рахується виявленим фішингом чи «безпечним» ham.
- Checkpoint не існує або має неправильну конфігурацію: тест у Task 5 доводить, що сервер завершується з помилкою й не підміняє його базовими вагами.

---

### Task 1: Зчитати додаткові корпуси без зміни їхніх міток

**Files:**
- Create: `scripts/large_eval/corpora.py` — адаптери Nazario mbox, Phishing Pot `.eml`, TREC tar-архівів, резервного авторського TREC CSV та SpamAssassin `.tar.bz2`.
- Create: `test/large_eval_corpora_test.py` — маленькі синтетичні архіви/MIME.
- Modify: `scripts/evaluate_local.py` — повторно використовувати поточний `message_from_bytes`, без зміни старого CLI.
- Modify: `package.json` — Python pattern `*_test.py`, щоб нові тести входили в `npm test`.

**Interfaces:**
- Produces `SourceMail(source: str, label: Literal['phishing','ham'], source_id: str, raw: bytes)`.
- Produces `iter_trec_ham(path: Path, source: str) -> Iterator[SourceMail]`, `iter_trec_csv_ham(path, source)`, `iter_nazario(path, source)`, `iter_phishing_pot(root)`, `iter_spamassassin(path, source)`.
- Consumers call `message_from_bytes(raw)` from existing evaluator; no adapter opens message URLs.

- [ ] **Step 1: Write failing tests.** Build an in-memory `.tgz` with `full/index` containing `ham ../data/inmail.1` and `spam ../data/inmail.2`; assert only one `SourceMail` is yielded. Build a CSV with labels `0` and `1`; assert only `0` is yielded when the source metadata confirms the original TREC `ham` mapping. Add MIME with a script, hidden block and attachment; assert its converted `MailMessage` has visible text/filename only. Add a too-large member and malformed index entry; assert rejection count, no raw content in exception text.

```python
rows = list(iter_trec_ham(trec_archive, "trec05"))
assert [(r.label, r.source_id) for r in rows] == [("ham", "inmail.1")]
assert b"spam body" not in b"".join(r.raw for r in rows)
```

- [ ] **Step 2: Run `python3 -m unittest discover -s test -p 'large_eval_corpora_test.py' -v`; confirm failure because the module is absent.**
- [ ] **Step 3: Implement archive readers.** Read TREC `full/index`, accept only exact `ham` label and `../data/inmail.<digits>` location, read members through `tarfile.extractfile()` without unpacking paths, cap each raw message at 256 KiB. The CSV fallback accepts only `label==0` after explicit source-level checksum, schema and aggregate-count verification against the original TREC ham count; reconstruct an `EmailMessage` from its sender/subject/body columns and yield `as_bytes()` through the same parser, marking `format=curated_csv` in the manifest. Do not pretend the CSV retained original HTML links or attachment metadata. Read only `.eml` under the Phishing Pot `email/` tree. Reuse existing `mailbox.mbox` and SpamAssassin filtering; never print subject/text/URL.

```python
@dataclass(frozen=True)
class SourceMail:
    source: str
    label: Literal["phishing", "ham"]
    source_id: str
    raw: bytes

def iter_trec_ham(path: Path, source: str) -> Iterator[SourceMail]:
    with tarfile.open(path, "r:*") as archive:
        names = {member.name: member for member in archive.getmembers()}
        prefix = next(name[:-len("full/index")] for name in names if name.endswith("/full/index"))
        index_file = archive.extractfile(names[prefix + "full/index"])
        if index_file is None:
            raise ValueError("TREC index is unreadable")
        for line in index_file.read().decode("ascii", errors="replace").splitlines():
            match = re.fullmatch(r"(ham|spam) \.\./data/(inmail\.\d+)", line)
            if match is None or match.group(1) != "ham":
                continue
            member = names.get(prefix + "data/" + match.group(2))
            if member is None or not member.isfile() or member.size > 256_000:
                continue
            stream = archive.extractfile(member)
            if stream is not None:
                yield SourceMail(source, "ham", match.group(2), stream.read())
```

- [ ] **Step 4: Run the focused test and old `evaluate_local_test.py`; both must pass.**
- [ ] **Step 5: Commit only the corpus reader/test/package change.**

### Task 2: Підготувати локальний кеш і незмінний split

**Files:**
- Create: `scripts/large_eval/prepare.py` — CLI для підготовки, дедуплікації та маніфесту.
- Create: `scripts/large_eval/split.py` — чисті функції нормалізації, відбитка і призначення split.
- Create: `test/large_eval_split_test.py` — сталість seed/поділу й відсутність витоку.
- Existing `fishingAnalizer/.gitignore` already ignores the entire `.cache/` tree; verify this with `git check-ignore` before writing records.

**Interfaces:**
- Consumes `Iterator[SourceMail]`, `message_from_bytes(raw)`.
- Produces ignored `train.jsonl`, `validation.jsonl`, `test.jsonl` із `{"id","source","label","message"}` і tracked-safe `manifest.json` із ID/гешами/кількостями **без** `message`.
- `CorpusPaths` is a dataclass with `nazario: dict[str, Path]`, `phishing_pot: Path`, `trec: dict[str, Path]`, `spamassassin: dict[str, Path]`; `prepare(paths: CorpusPaths, out_dir: Path, seed: int = 20260924) -> dict` returns only a content-free manifest.

- [ ] **Step 1: Write failing tests.** Insert identical and near-identical synthetic messages in two sources, a conflicting-label duplicate, a broken MIME and a letter whose visible text is empty. Assert one split per surviving fingerprint, conflicting labels excluded, stable manifest across runs, and no `sender`, `subject`, `text`, `links`, `message` keys in `manifest.json`.

```python
first = prepare(fixture_paths, temp_a, seed=20260924)
second = prepare(fixture_paths, temp_b, seed=20260924)
assert first == second
assert set(first["ids_by_split"]["test"]).isdisjoint(first["ids_by_split"]["train"])
```

- [ ] **Step 2: Run focused test; confirm missing functions fail.**
- [ ] **Step 3: Implement streaming preparation.** Normalize visible subject/text to Unicode NFKC + casefold + collapsed whitespace; exact SHA-256 plus 64-bit SimHash of at most 256 word trigrams, using 16-bit buckets and Hamming distance at most 3 for near duplicates. Give precedence to `test`, then `validation`, then `train`; conflicting labels remove all copies. Apply the exact source/year policy from the spec; if TREC05+06 leave fewer than 50 000 unique test rows, rebuild once with all TREC07 ham in test and SpamAssassin `easy_ham`/`easy_ham_2` in train, `hard_ham` in validation. Write JSONL with `os.open(..., 0o600)` and atomic rename. Include source URL, SHA-256, counted exclusions, seed, split policy and IDs in the content-free manifest.

```python
def split_for(source: str, trec07_in_test: bool) -> str:
    if source in {"nazario-2024", "nazario-2025", "phishing-pot", "trec05", "trec06"}:
        return "test"
    if source in {"nazario-2022", "nazario-2023"}:
        return "validation"
    if source == "trec07":
        return "test" if trec07_in_test else "train"
    if source.startswith("spamassassin-"):
        if trec07_in_test and source != "spamassassin-hard_ham":
            return "train"
        return "validation"
    return "train"
```

- [ ] **Step 4: Run focused tests. Inspect only source counts/hashes and `git status`; stop if raw JSONL appears as untracked.**
- [ ] **Step 5: Commit source and tests, excluding every corpus and cache file.**

### Task 3: Міряти три стани, помилки та латентність без втрати знаменників

**Files:**
- Create: `scripts/large_eval/metrics.py` — чистий агрегатор і Wilson 95% interval.
- Create: `scripts/large_eval/evaluate.py` — CLI `--split validation|test --out <json>`.
- Create: `test/large_eval_metrics_test.py` — синтетична матриця й помилки.
- Modify: `scripts/evaluate_core.ts` — повертати окремі `layaMs` і `backendMs`, не дублюючи запит.

**Interfaces:**
- Consumes prepared JSONL; uses existing `start_core()` and production `analyze()`.
- Produces aggregate-only JSON with `matrix`, `by_source`, `by_year`, `recall`, `fpr`, `precision`, `specificity`, `f1`, `balanced_accuracy`, `review_rate`, `error_rate`, median/p95 and `wall_time_s`.

- [ ] **Step 1: Write failing tests.** For two phishing (`suspicious`, `review`) and two ham (`suspicious`, `no_signals`) assert phishing recall `0.5`, ham FPR `0.5`, `review_rate=0.25`; inject an error and assert it remains in the matrix and denominators. Check empty denominator yields JSON `null`, never NaN.

```python
matrix = {"phishing": {"suspicious": 1, "review": 1},
          "ham": {"suspicious": 1, "no_signals": 1}}
assert summarize(matrix)["phishing_recall"] == 0.5
assert summarize(matrix)["ham_fpr"] == 0.5
```

- [ ] **Step 2: Run focused Python and Node tests; confirm expected failure.**
- [ ] **Step 3: Implement metrics and evaluator.** Keep every original label in the denominator; print progress counts only. Define strict recall as `phishing.suspicious / all_phishing`, FPR as `ham.suspicious / all_ham`, strict specificity as `ham.no_signals / all_ham`, precision as `phishing.suspicious / all_suspicious`, F1 from precision/recall, balanced accuracy from strict recall/specificity, with `review` and `error` excluded from numerators but retained in class totals. In `evaluate_core.ts`, measure time inside the wrapped `fetcher` for Laya and around `analyze()` for backend, then emit both statuses and times; keep existing `evaluate_local.py` compatible with the two status fields. The Python runner must check `/health`, model/checkpoint identity (`/checkpoint` for tuned, base HF revision for stock) and manifest hash before starting; errors become `error` rows. Use Wilson intervals for proportions, fixed 20260924 manifest and monotonic timing. Do not include per-message outputs in JSON.

```ts
const start = performance.now();
const result = await analyze('local', message, { fetcher });
process.stdout.write(JSON.stringify({ laya: choice, backend: result.status,
  layaMs, backendMs: performance.now() - start }) + '\n');
```

- [ ] **Step 4: Run focused tests and a synthetic local preflight; verify JSON has no fixture text/URL.**
- [ ] **Step 5: Commit evaluator and tests.**

### Task 4: Навчити п'ять версій справжніх ваг

**Files:**
- Create: `localModel/train_head.py` — п'ять епох, синтетичний smoke test, атомарні checkpoint.
- Create: `test/large_eval_training_test.py` — градієнт і сумісність checkpoint на маленькій моделі/моках без завантаження ваг у unit-тесті.
- Modify: `localModel/README.md` — команди навчання та локальні шляхи.

**Interfaces:**
- Consumes ignored `train.jsonl` and `QUESTION` from `scripts/evaluate_local.py`, already pinned to the production `backend/adapters.ts` hash in benchmark reports.
- Produces `.cache/checkpoints/epoch-01` … `epoch-05`, each with Laya-compatible `model.safetensors`, `rl_agent_config.json`, `tokenizer/`, `encoder/`, plus content-free `training.json`.

- [ ] **Step 1: Write failing tests.** Verify every instruction/criterion string in Python `QUESTION` matches the production question in `backend/adapters.ts`, encoder parameters stay byte-identical, `head`/`type_emb`/`scorer` receive finite nonzero gradients, each epoch changes the head hash, and checkpoint writer creates the expected config/tokenizer/encoder/weights layout. Use a tiny synthetic model fixture; do not download the real model in unit tests. The real CUDA smoke test in Step 4 must reload through `laya.Agent(path, device='cuda')`.

```python
before = hash_parameters(agent.model.head)
train_one_step(agent, synthetic_batch, label="phishing")
assert hash_parameters(agent.model.head) != before
assert all(not p.requires_grad for p in agent.model.encoder.parameters())
```

- [ ] **Step 2: Run focused test; confirm expected failure.**
- [ ] **Step 3: Implement training.** Load `Agent('convaiinnovations/laya', subfolder='multilingual', device='cuda')`, set encoder `requires_grad_(False)` and `eval()`, build sequences with `laya.common.build_sequence()` and the identical `state={"message": message}`/question format from backend. Optimize only `head`, `type_emb`, `scorer` with AdamW (`lr=1e-4`, `weight_decay=0.01`); multiply each sample's cross entropy by `N/(2*N_label)` to counter the training class imbalance, on index 0 (`suspicious`) or 2 (`no_signals`). Clip gradient norm to 1, use microbatch 1 and gradient accumulation 8. Seed Python/NumPy/Torch with 20260924; run a CUDA OOM/gradient smoke test before corpus training. Save full state with `safetensors` atomically after **each** of exactly five epochs, preserving the base checkpoint. Record optimizer settings, package versions, seed, epoch loss, weight SHA-256, GPU name and manifest hash, no mail text. Abort on nonfinite loss or wrong device; never silently fall back to CPU.

```python
for p in agent.model.encoder.parameters():
    p.requires_grad_(False)
target = torch.tensor([0 if label == "phishing" else 2], device="cuda")
logits, _ = agent.model(input_ids, mask, marker_pos, marker_mask, qtype,
                        detach_encoder=True)
loss = F.cross_entropy(logits, target) * class_weight[label]
```

- [ ] **Step 4: Run unit tests with `localModel/.venv/bin/python -m unittest discover -s test -p 'large_eval_training_test.py' -v` and one real 2-message CUDA smoke test; inspect only hashes and memory use. Stop and report if 12 GiB VRAM cannot hold it.**
- [ ] **Step 5: Commit trainer/tests/documentation; exclude checkpoint files.**

### Task 5: Подати навчений checkpoint через той самий локальний API

**Files:**
- Create: `localModel/serve_checkpoint.py` — `Router.attach('multilingual', Agent(path))` + `laya.serve.create_app()`.
- Create: `test/large_eval_serve_test.py` — вибір бази/навчених ваг та помилка конфігурації.
- Modify: `localModel/start.sh`, `start-all.sh`, `localModel/README.md` — `LAYA_CHECKPOINT=base|<absolute path>`, перевірка активного checkpoint.

**Interfaces:**
- `build_app(checkpoint: Path)` builds the local FastAPI app or raises before binding a port.
- HTTP `/v1/systemone` лишається незмінним для backend; `GET /checkpoint` повертає тільки `kind`, SHA-256 ваг, GPU і версію Laya.
- Consumes checkpoint із Task 4. База лишається типовою при відсутній змінній.

- [ ] **Step 1: Write failing tests.** Start app with a fake router and assert `/v1/systemone` keeps `answers.phishing_risk.choice`; invalid checkpoint path raises before binding port. Assert `start-all.sh` refuses to reuse a running Laya with a different checkpoint when `LAYA_CHECKPOINT` is explicit.

```python
with self.assertRaises(FileNotFoundError):
    build_app(Path("/no/such/checkpoint"))
self.assertEqual(checkpoint_info(checkpoint)["sha256"], expected_hash)
```

- [ ] **Step 2: Run focused tests; confirm missing server function fails.**
- [ ] **Step 3: Implement custom startup for trained model only.** Load local `Agent` from absolute path, attach to `Router` under `multilingual`, call official `create_app(router)`, add content-free `/checkpoint` endpoint. Keep existing `laya-serve` for `base`. Validate expected files and SHA-256 before loading; never substitute base weights on failure. `start-all.sh` compares active `/checkpoint` to requested path/hash and asks to stop the old process when they differ.

```python
agent = Agent(str(checkpoint), device=os.environ["LAYA_DEVICE"])
router = Router(device=os.environ["LAYA_DEVICE"])
router.attach("multilingual", agent)
app = create_app(router)
```

- [ ] **Step 4: Run tests and one synthetic end-to-end request through backend with epoch-01 on GPU.**
- [ ] **Step 5: Commit serving integration and tests.**

### Task 6: Повний прогін, п'ята контрольна і звіт

**Files:**
- Create: `docs/laya-large-benchmark.md` — таблиці й межі висновку.
- Modify: `README.md` — точні команди підготовки, навчання, оцінювання, запуску checkpoint.
- Modify: `docs/local-model-evaluation.md` — посилання на новий звіт, без переписування старих результатів.

**Interfaces:**
- Consumes content-free manifests, training metadata and aggregate JSON from Tasks 2–5.
- Produces committed report only; raw mail and weight files stay in ignored cache.

- [ ] **Step 1: Завантажити публічні архіви в ignored cache.** Для кожного джерела перевірити URL/дозволені умови, SHA-256, фактичні кількості. Якщо офіційні TREC-архіви недоступні, перевірити відповідність ham-рядків [авторському Zenodo-виданню](https://zenodo.org/records/8339691) й зафіксувати зміну формату в звіті; за відсутності доказу відповідності не використовувати CSV як первинний ham. Не друкувати sample rows.
- [ ] **Step 2: Запустити `prepare.py`; переглянути агрегатний маніфест, 50k-ціль, відкинуті записи, відсутність витоку в Git.** Якщо вибірка менша, не змінювати міток заради кількості.
- [ ] **Step 3: Запустити п'ять епох і оцінити кожен `epoch-01` … `epoch-05` лише на `validation`; записати таблицю по всіх п'яти.** Залишити тристатусне рішення моделі без додаткового порога; звіт не має називати ці ймовірності відкаліброваними. До завершення цього кроку не відкривати метрики `test`.
- [ ] **Step 4: Зафіксувати вибір checkpoint для запуску лише за validation, потім запустити базовий GPU-прогін на `test` і зберегти aggregate-only JSON.**
- [ ] **Step 5: Запустити `epoch-05` на недоторканому `test` і повторити ту саму п'яту версію на тому самому manifest; порівняти матриці, хеші та latency.** Не використовувати повтор як нові незалежні приклади. Порівняти з базою за FPR, recall і latency; окремо назвати, якщо попередньо обраний за validation checkpoint — не epoch-05.
- [ ] **Step 6: Зробити вибіркову перевірку HTTP/backend на синтетичних листах, запустити `npm test`, `npm run build`, `bash -n start-all.sh localModel/start.sh`, перевірити `git diff --check`.** Під час тестів не запускати паралельно інші процеси на тих самих портах.
- [ ] **Step 7: Заповнити звіт реальними числами, 95% інтервалами, абсолютними знаменниками, джерелами, хешами, версіями, часом, помилками, порівнянням усіх ітерацій та обмеженнями Gmail DOM.** Якщо прогін або навчання не завершено, явно вказати саме це замість числа точності.
- [ ] **Step 8: Переглянути diff і Git status; закомітити лише код, тести й агрегатний звіт та запушити в `origin/main` на підставі наявного прямого прохання користувача.**
