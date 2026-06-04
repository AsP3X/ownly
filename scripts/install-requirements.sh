#!/usr/bin/env bash
#
# Install Python dependencies from scripts/requirements.txt into scripts/.venv.
#
# Prerequisite: virtualenv at scripts/.venv (create with setup-test-env.sh).
#
# Usage (from repo root):
#   bash scripts/install-requirements.sh
#
# Options:
#   --create-venv   Create scripts/.venv with python3 -m venv if missing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
REQ_FILE="$SCRIPT_DIR/requirements.txt"
CREATE_VENV=0

for arg in "$@"; do
  case "$arg" in
    --create-venv) CREATE_VENV=1 ;;
    -h|--help)
      echo "Usage: bash scripts/install-requirements.sh [--create-venv]"
      echo "  Installs scripts/requirements.txt into scripts/.venv"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$REQ_FILE" ]; then
  echo "Error: requirements file not found: $REQ_FILE" >&2
  exit 1
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
  if [ "$CREATE_VENV" -eq 1 ]; then
    if command -v python3 >/dev/null 2>&1; then
      PYTHON=python3
    elif command -v python >/dev/null 2>&1; then
      PYTHON=python
    else
      echo "Error: python3 or python not found in PATH" >&2
      exit 1
    fi
    echo "==> Creating virtual environment at $VENV_DIR"
    "$PYTHON" -m venv "$VENV_DIR"
  else
    echo "Error: no virtualenv at $VENV_DIR" >&2
    echo "Run: bash scripts/setup-test-env.sh" >&2
    echo "Or: bash scripts/install-requirements.sh --create-venv" >&2
    exit 1
  fi
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "==> Upgrading pip, wheel, setuptools"
python -m pip install --upgrade pip wheel setuptools

echo "==> Installing from $REQ_FILE"
python -m pip install -r "$REQ_FILE"

echo ""
echo "==> Done. Dependencies installed in: $VENV_DIR"
echo "Activate with: source $VENV_DIR/bin/activate"
