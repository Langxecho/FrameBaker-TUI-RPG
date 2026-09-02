#!/usr/bin/env bash
# FrameBaker media-plugin Python runtime: create .venv-media/ and install base dep `requests` only.
# Does not read or execute plugin-declared dependency install commands.
# Prefers `uv` when available (same policy as setup_media.ps1 / setup_matting.ps1); otherwise python3 venv + pip.
# Usage:
#   ./scripts/setup_media.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VENV=".venv-media"
PYTHON="${PYTHON:-python3}"
RUNTIME_DEPS=(requests)

resolve_venv_python() {
  if [ -x "$VENV/bin/python" ]; then
    echo "$VENV/bin/python"
  elif [ -x "$VENV/bin/python3" ]; then
    echo "$VENV/bin/python3"
  else
    return 1
  fi
}

install_runtime_deps() {
  local py="$1"
  echo "→ ensuring base runtime deps: ${RUNTIME_DEPS[*]}"
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "$py" "${RUNTIME_DEPS[@]}"
  else
    "$VENV/bin/pip" install "${RUNTIME_DEPS[@]}"
  fi
}

if PY="$(resolve_venv_python)"; then
  echo "media Python already installed: $PY"
  install_runtime_deps "$PY"
  echo "Ready: $PY"
  exit 0
fi

if command -v uv >/dev/null 2>&1; then
  echo "→ creating venv with uv: $VENV"
  uv venv --python 3.12 "$VENV"
  PY="$(resolve_venv_python)"
  echo "→ installing base runtime deps with uv: ${RUNTIME_DEPS[*]}"
  uv pip install --python "$PY" "${RUNTIME_DEPS[@]}"
else
  command -v "$PYTHON" >/dev/null 2>&1 || {
    echo "ERROR: uv or python3 was not found. Install uv from https://docs.astral.sh/uv/ or Python 3, then retry."
    exit 1
  }
  echo "→ creating venv: $VENV ($("$PYTHON" --version 2>&1))"
  "$PYTHON" -m venv "$VENV"
  echo "→ upgrading pip"
  "$VENV/bin/pip" install --upgrade pip
  PY="$(resolve_venv_python)"
  echo "→ installing base runtime deps: ${RUNTIME_DEPS[*]}"
  "$VENV/bin/pip" install "${RUNTIME_DEPS[@]}"
fi

echo ""
echo "Installation complete: $PY"
echo "  FrameBaker will use this interpreter for .iap/.vap/.aap provider.py execution."
