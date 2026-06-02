#!/bin/sh
# Human: Print a unified diff of uncommitted Nebular work vs the commit Ownly pins in the submodule.
# Agent: READS superproject gitlink; CALLS git -C nebular-os diff; WRITES to stdout for upstream handoff.

set -e

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ ! -f .gitmodules ] || ! grep -q 'nebular-os' .gitmodules 2>/dev/null; then
  echo "Error: nebular-os submodule not configured in .gitmodules" >&2
  exit 1
fi

if [ ! -d nebular-os ]; then
  echo "Error: nebular-os/ missing — run: git submodule update --init --recursive" >&2
  exit 1
fi

pinned=$(git rev-parse :nebular-os 2>/dev/null || true)
if [ -z "$pinned" ]; then
  echo "Error: could not read pinned submodule commit for nebular-os" >&2
  exit 1
fi

head=$(git -C nebular-os rev-parse HEAD 2>/dev/null || true)
if [ -z "$head" ]; then
  echo "Error: nebular-os submodule not initialized" >&2
  exit 1
fi

echo "# Nebular OS patch export (apply in https://github.com/AsP3X/nebular-os)"
echo "# Ownly pinned commit: $pinned"
echo "# Submodule HEAD:      $head"
echo "#"

if [ "$pinned" = "$head" ]; then
  dirty=$(git -C nebular-os status --porcelain 2>/dev/null || true)
  if [ -z "$dirty" ]; then
    echo "# No diff: submodule matches pin and working tree is clean."
    exit 0
  fi
  echo "# Working tree changes vs pinned commit:"
  git -C nebular-os diff "$pinned"
  exit 0
fi

echo "# Committed diff from pinned commit to current submodule HEAD:"
git -C nebular-os diff "$pinned" "$head"

dirty=$(git -C nebular-os status --porcelain 2>/dev/null || true)
if [ -n "$dirty" ]; then
  echo "#"
  echo "# Additional uncommitted changes on top of HEAD:"
  git -C nebular-os diff
fi
