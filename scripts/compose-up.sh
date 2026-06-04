#!/bin/sh
# Human: Wrapper so host shell exports cannot override Compose .env for secret substitution.
# Agent: UNSETS secret vars; EXEC docker compose; USE ./scripts/compose-up.sh up -d --build
set -e
cd "$(dirname "$0")/.."
unset SETUP_TOKEN JWT_SECRET SIGNING_SECRET NOS_JWT_SECRET NOS_SIGNING_SECRET OBJECT_STORAGE_JWT_SECRET
exec docker compose "$@"
