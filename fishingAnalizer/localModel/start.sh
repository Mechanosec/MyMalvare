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
requested_device="${LAYA_DEVICE:-auto}"
case "$requested_device" in
  auto)
    if "$model_dir/.venv/bin/python" -I -c 'import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)'; then
      device=cuda
    else
      device=cpu
    fi
    ;;
  cpu|cuda) device="$requested_device" ;;
  *) echo 'LAYA_DEVICE має бути auto, cpu або cuda.' >&2; exit 1 ;;
esac
if [[ "$device" == cuda ]]; then
  "$model_dir/.venv/bin/python" -I -c 'import torch; assert torch.cuda.is_available(), "CUDA недоступна: запустіть bash localModel/setup.sh"' || exit 1
fi
export LAYA_DEVICE="$device"
export LAYA_PRELOAD=1
export LAYA_MODELS=multilingual
export LAYA_LOG_LEVEL=warning
export USE_TF=0
echo "Запускаю Laya Multilingual на $LAYA_DEVICE."
exec "$model_dir/.venv/bin/laya-serve"
