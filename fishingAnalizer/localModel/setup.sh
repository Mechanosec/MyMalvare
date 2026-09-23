#!/usr/bin/env bash
set -euo pipefail

model_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 -m venv "$model_dir/.venv"
"$model_dir/.venv/bin/python" -m pip install --no-cache-dir 'torch==2.14.0+cpu' --index-url https://download.pytorch.org/whl/cpu
"$model_dir/.venv/bin/python" -m pip install --no-cache-dir -r "$model_dir/requirements.txt"
"$model_dir/.venv/bin/python" -I -c 'import laya; print("Laya", laya.__version__)'
