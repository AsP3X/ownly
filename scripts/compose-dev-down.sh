#!/bin/sh
set -e
cd "$(dirname "$0")/.."

destroy=false
if [ "${1:-}" = "--destroy-volumes" ]; then
  if [ "${MEDIAVAULT_CONFIRM_DESTROY_DATA:-}" != "yes" ]; then
    echo "Refusing to destroy volumes. Set MEDIAVAULT_CONFIRM_DESTROY_DATA=yes to confirm data loss."
    exit 1
  fi
  destroy=true
fi

if [ "$destroy" = true ]; then
  docker compose down -v
else
  docker compose down
fi
