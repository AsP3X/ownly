#!/bin/sh
# Human: Point this repo's Git hooks at .githooks/ (pre-commit blocks nebular-os source commits).
# Agent: RUNS from repo root; SETS local core.hooksPath only in this clone via git config.

set -e

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ ! -f .githooks/pre-commit ]; then
  echo "Error: .githooks/pre-commit not found" >&2
  exit 1
fi

chmod +x .githooks/pre-commit

git config core.hooksPath .githooks
echo "Installed Git hooks: core.hooksPath=.githooks"
echo "pre-commit will block commits under nebular-os/* (submodule pointer bumps at nebular-os are allowed)."
