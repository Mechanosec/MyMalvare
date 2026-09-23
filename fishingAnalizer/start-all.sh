#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

for command in node npm python3 curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Потрібна команда: $command" >&2
    exit 1
  fi
done

requested_device="${LAYA_DEVICE:-auto}"
case "$requested_device" in
  cpu) gpu_requested=false ;;
  cuda) gpu_requested=true ;;
  auto)
    gpu_requested=false
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
      gpu_requested=true
    fi
    ;;
  *) echo 'LAYA_DEVICE має бути auto, cpu або cuda.' >&2; exit 1 ;;
esac

backend_pid=''
laya_pid=''
cleanup() {
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$laya_pid" ]]; then kill "$laya_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then wait "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$laya_pid" ]]; then wait "$laya_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

backend_ready() {
  curl -fsS --max-time 2 http://127.0.0.1:8787/health 2>/dev/null |
    python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(0 if data.get("ok") is True and data.get("service") == "fishingAnalizer" else 1)' 2>/dev/null
}

laya_ready() {
  curl -fsS --max-time 2 http://127.0.0.1:8000/health 2>/dev/null |
    python3 -c 'import json,sys; data=json.load(sys.stdin); loaded=data.get("loaded"); sys.exit(0 if data.get("status") == "ok" and isinstance(loaded,list) and "multilingual" in loaded else 1)' 2>/dev/null
}

laya_device() {
  curl -fsS --max-time 2 http://127.0.0.1:8000/health 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("device", "unknown"))' 2>/dev/null
}

checkpoint_matches() {
  local requested="${LAYA_CHECKPOINT:-base}"
  if [[ "$requested" == base ]]; then
    [[ "$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' \
      http://127.0.0.1:8000/checkpoint 2>/dev/null)" == 404 ]]
    return $?
  fi
  if [[ "$requested" != /* || ! -f "$requested/model.safetensors" ]]; then
    echo 'LAYA_CHECKPOINT має бути base або абсолютним шляхом до наявного checkpoint.' >&2
    return 1
  fi
  local digest
  digest="$(sha256sum "$requested/model.safetensors")"
  digest="${digest%% *}"
  curl -fsS --max-time 2 http://127.0.0.1:8000/checkpoint 2>/dev/null |
    python3 -c 'import json,sys; active=json.load(sys.stdin); sys.exit(0 if active.get("sha256") == sys.argv[1] else 1)' "$digest" 2>/dev/null
}

torch_cuda_ready() {
  [[ -x localModel/.venv/bin/python ]] &&
    localModel/.venv/bin/python -I -c 'import pathlib,sys,sysconfig,torch; headers=(pathlib.Path(sysconfig.get_path("include"))/"Python.h").is_file(); sys.exit(0 if torch.cuda.is_available() and headers else 1)' >/dev/null 2>&1
}

wait_until_ready() {
  local name="$1" probe="$2" pid="$3"
  echo "Очікую на $name…"
  until "$probe"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name завершився до запуску. Переглянь помилку вище." >&2
      return 1
    fi
    sleep 2
  done
}

analysis_ready() {
  node --input-type=module <<'NODE'
const message = {
  sender: { name: 'Test', email: 'test@example.org' },
  subject: 'Test', text: 'Hello.', links: [], attachments: [], truncated: false,
};
try {
  const response = await fetch('http://127.0.0.1:8787/analyze', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'startup-check', mode: 'local', message }),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok || !['suspicious', 'review', 'no_signals'].includes(result.status)) {
    throw Error(result.error?.code || `HTTP ${response.status}`);
  }
} catch (error) {
  console.error(`Пробний аналіз Laya не вдався: ${error.message}`);
  process.exitCode = 1;
}
NODE
}

if [[ ! -x node_modules/.bin/tsc ]]; then
  echo 'Встановлюю npm-залежності…'
  npm ci
fi

echo 'Збираю Chrome-розширення й backend…'
npm run build

if laya_ready; then
  if ! checkpoint_matches; then
    echo 'На порту 8000 працює інший checkpoint Laya. Зупини старий процес і запусти скрипт знову.' >&2
    exit 1
  fi
  active_device="$(laya_device)"
  if [[ "$gpu_requested" == true && "$active_device" != cuda ]]; then
    echo 'Laya на порту 8000 працює на CPU. Зупини старий процес і запусти скрипт знову для GPU.' >&2
    exit 1
  fi
  if [[ "$requested_device" == cpu && "$active_device" != cpu ]]; then
    echo 'Laya на порту 8000 працює на GPU. Зупини старий процес і запусти скрипт знову для CPU.' >&2
    exit 1
  fi
  echo "Laya уже працює на 127.0.0.1:8000 ($active_device); використовую її без перезапуску."
else
  if curl -sS --max-time 2 http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo 'Порт 8000 зайнятий сервісом, який не є Laya Multilingual.' >&2
    exit 1
  fi
  if [[ ! -x localModel/.venv/bin/laya-serve ]] ||
     { [[ "$gpu_requested" == true ]] && ! torch_cuda_ready; }; then
    echo 'Встановлюю локальну Laya й PyTorch для обраного пристрою…'
    bash localModel/setup.sh
  fi
  echo 'Запускаю Laya; завантаження моделі може тривати кілька хвилин…'
  bash localModel/start.sh &
  laya_pid=$!
  wait_until_ready 'Laya' laya_ready "$laya_pid"
  echo "Laya відповідає на 127.0.0.1:8000 ($(laya_device))."
fi

if backend_ready; then
  echo 'Backend уже працює на 127.0.0.1:8787; використовую його без перезапуску.'
else
  if curl -sS --max-time 2 http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo 'Порт 8787 зайнятий сервісом, який не є fishingAnalizer backend.' >&2
    exit 1
  fi
  node dist/backend/index.js &
  backend_pid=$!
  wait_until_ready 'backend' backend_ready "$backend_pid"
fi

if ! analysis_ready; then
  echo 'Сервери запущені, але модель не змогла проаналізувати тестовий лист.' >&2
  exit 1
fi

cat <<EOF

Готово. У Chrome відкрий chrome://extensions → Режим розробника → Load unpacked.
Вибери каталог: $project_dir/dist/extection
Адреса backend і локальна Laya вже вибрані за замовчуванням.
Відкрий лист у Gmail і дай згоду на передачу його вмісту локальному серверу.
EOF

if [[ -n "$backend_pid" || -n "$laya_pid" ]]; then
  running_pids=()
  if [[ -n "$backend_pid" ]]; then running_pids+=("$backend_pid"); fi
  if [[ -n "$laya_pid" ]]; then running_pids+=("$laya_pid"); fi
  echo 'Залиш цей термінал відкритим. Ctrl+C зупинить процеси, запущені цим скриптом.'
  wait -n "${running_pids[@]}" || true
  echo 'Один із запущених серверів завершився; зупиняю решту.' >&2
fi
