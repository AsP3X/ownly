#!/usr/bin/env bash
#
# Creates a Python virtual environment for the testing / audit scripts
# (security-audit and storage-audit) and installs required dependencies.
#
# Works on macOS and Linux.
#
# Usage:
#   bash scripts/setup-test-env.sh
#
# After running:
#   source scripts/.venv/bin/activate
#   # Re-install deps only (venv already exists):
#   bash scripts/install-requirements.sh
#   # then run e.g.
#   python scripts/storage-audit.py
#   python -m unittest discover -s scripts/security-audit/tests -v
#
# The security-audit scripts require no third-party packages (stdlib only).
# storage-audit.py pulls in psycopg[binary].

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "==> Creating virtual environment at $VENV_DIR"

# Prefer python3; fall back to python if needed (some Linux minimal installs).
if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
elif command -v python >/dev/null 2>&1; then
    PYTHON=python
else
    echo "Error: python3 or python not found in PATH" >&2
    exit 1
fi

# On Debian/Ubuntu etc you may need: sudo apt-get install python3-venv python3-pip
$PYTHON -m venv "$VENV_DIR"

# Activate for this script (portable across bash/zsh)
echo "==> Installing dependencies"
bash "$SCRIPT_DIR/install-requirements.sh"

echo ""
echo "==> Done. Virtual environment created at: $VENV_DIR"
echo ""
echo "Activate it with:"
echo "  source $VENV_DIR/bin/activate"
echo ""
echo "Deactivate later with: deactivate"
echo ""
echo "Example runs (after activating):"
echo "  python -m unittest discover -s scripts/security-audit/tests -v"
echo "  python scripts/security-audit/sec001_setup_info_disclosure.py --help"
echo "  python scripts/storage-audit.py"
echo ""
echo "  # Makefile targets auto-detect ../.venv when present:"
echo "  make -C scripts/security-audit test"
echo "  make -C scripts/security-audit sec001"
