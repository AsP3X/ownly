#!/usr/bin/env bash
# Human: Apply server-side blob migration support to the pinned nebular-os submodule checkout.
# Agent: RUN from repo root; CALLS git apply on docs/patches/nebular-blob-migration.patch; REBUILD object-storage image after.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
patch="${root}/docs/patches/nebular-blob-migration.patch"

if [ ! -d "${root}/nebular-os" ]; then
  echo "Error: nebular-os submodule missing — run: git submodule update --init --recursive" >&2
  exit 1
fi

if [ ! -f "$patch" ]; then
  echo "Error: patch not found at $patch" >&2
  exit 1
fi

cd "${root}/nebular-os"
if git apply --check "$patch" 2>/dev/null; then
  git apply "$patch"
  echo "Applied nebular blob migration patch. Rebuild object-storage: docker compose build object-storage"
else
  echo "Patch already applied or conflicts with local nebular-os changes." >&2
  echo "Export local diffs with: bash scripts/nebular-export-patch.sh" >&2
  exit 1
fi
