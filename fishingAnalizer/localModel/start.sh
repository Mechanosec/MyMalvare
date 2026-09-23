#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -x "$model_dir/.venv/bin/laya-serve" ]]; then
  echo 'Laya ще не встановлена. Спочатку запустіть: bash localModel/setup.sh' >&2
  exit 1
fi

mkdir -p "$model_dir/.cache/huggingface"
export HF_HOME="$model_dir/.cache/huggingface"
export LAYA_HOST=127.0.0.1
export LAYA_PORT=8000
export LAYA_DEVICE=cpu
export LAYA_PRELOAD=1
export LAYA_MODELS=multilingual
export USE_TF=0
exec "$model_dir/.venv/bin/laya-serve"
