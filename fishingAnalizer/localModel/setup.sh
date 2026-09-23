#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
requested_device="${LAYA_DEVICE:-auto}"
case "$requested_device" in
  auto)
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
      device=cuda
    else
      device=cpu
    fi
    ;;
  cpu|cuda) device="$requested_device" ;;
  *) echo 'LAYA_DEVICE має бути auto, cpu або cuda.' >&2; exit 1 ;;
esac

if [[ "$device" == cuda ]] && ! nvidia-smi -L >/dev/null 2>&1; then
  echo 'NVIDIA GPU або драйвер недоступні для CUDA.' >&2
  exit 1
fi

has_python_headers() {
  "$1" -I -c 'import pathlib,sysconfig,sys; sys.exit(0 if (pathlib.Path(sysconfig.get_path("include"))/"Python.h").is_file() else 1)'
}

python=python3
if [[ "$device" == cuda ]] && ! has_python_headers python3; then
  if ! command -v uv >/dev/null 2>&1; then
    echo 'Для CUDA потрібні заголовки Python: встановіть python3-devel або uv.' >&2
    exit 1
  fi
  echo 'Системний Python без Python.h; беру Python 3.13 з uv для Triton.'
  export UV_CACHE_DIR="$model_dir/.cache/uv"
  uv python install 3.13
  python="$(uv python find --managed-python 3.13)"
fi

if [[ -x "$model_dir/.venv/bin/python" && "$device" == cuda ]] &&
   ! has_python_headers "$model_dir/.venv/bin/python"; then
  rm -rf -- "$model_dir/.venv"
fi
if [[ ! -x "$model_dir/.venv/bin/python" ]]; then "$python" -m venv "$model_dir/.venv"; fi
if [[ "$device" == cuda ]]; then
  torch_package='torch==2.14.0+cu130'
  torch_index='https://download.pytorch.org/whl/cu130'
else
  torch_package='torch==2.14.0+cpu'
  torch_index='https://download.pytorch.org/whl/cpu'
fi
echo "Встановлюю PyTorch для $device…"
"$model_dir/.venv/bin/python" -m pip install --no-cache-dir --upgrade "$torch_package" --index-url "$torch_index"
"$model_dir/.venv/bin/python" -m pip install --no-cache-dir -r "$model_dir/requirements.txt"
"$model_dir/.venv/bin/python" -I -c 'import laya, torch; print("Laya", laya.__version__, "PyTorch", torch.__version__)'
if [[ "$device" == cuda ]]; then
  "$model_dir/.venv/bin/python" -I -c 'import torch; assert torch.cuda.is_available(), "CUDA недоступна після встановлення PyTorch"; x=torch.ones((64,64),device="cuda"); torch.cuda.synchronize(); print("CUDA:",torch.cuda.get_device_name(0),x.device)'
fi
