#!/usr/bin/env bash
# Human: Operator helper — batch-migrate legacy Nebular blobs via the Ownly admin API.
# Agent: READS OWNLY_API_URL + admin JWT; POST /api/v1/admin/maintenance/migrate-storage-blobs in a loop.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

API_URL="${OWNLY_API_URL:-http://localhost:8080}"
ADMIN_TOKEN="${OWNLY_ADMIN_TOKEN:-}"
PREFIX="${MIGRATE_PREFIX:-}"
NODE_ID="${MIGRATE_NODE_ID:-}"
LIMIT="${MIGRATE_LIMIT:-25}"
DRY_RUN="${MIGRATE_DRY_RUN:-false}"
START_AFTER="${MIGRATE_START_AFTER:-}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "Error: set OWNLY_ADMIN_TOKEN to an admin session JWT." >&2
  exit 1
fi

query="limit=${LIMIT}&dry_run=${DRY_RUN}"
if [ -n "$PREFIX" ]; then
  query="${query}&prefix=$(printf '%s' "$PREFIX" | jq -sRr @uri)"
fi
if [ -n "$NODE_ID" ]; then
  query="${query}&node_id=$(printf '%s' "$NODE_ID" | jq -sRr @uri)"
fi
if [ -n "$START_AFTER" ]; then
  query="${query}&start_after=$(printf '%s' "$START_AFTER" | jq -sRr @uri)"
fi

echo "POST ${API_URL}/api/v1/admin/maintenance/migrate-storage-blobs?${query}"

curl -fsS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "${API_URL}/api/v1/admin/maintenance/migrate-storage-blobs?${query}"

echo
