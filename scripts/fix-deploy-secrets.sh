#!/bin/sh
# Human: Emergency fix when the API exits on SETUP_TOKEN / weak JWT secrets in Docker Compose.
# Agent: WRITES random SETUP_TOKEN (and other weak keys) into root .env; DOES NOT print secrets.
set -e
cd "$(dirname "$0")/.."

if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: openssl required (install openssl or use the host, not Alpine init container)."
    exit 1
fi

# Agent: Shell exports override Compose .env — clear common secret overrides.
unset SETUP_TOKEN JWT_SECRET SIGNING_SECRET NOS_JWT_SECRET NOS_SIGNING_SECRET OBJECT_STORAGE_JWT_SECRET

WEAK_SECRETS="GENERATE_ME change-me-in-production change-me-in-production-jwt-secret dev-jwt-secret-change-me dev-nos-jwt-secret-change-me dev-nos-signing-secret-change-me ownly-master-key"

normalize_env_value() {
    printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

is_weak() {
    value=$(normalize_env_value "$1")
    [ -z "$value" ] && return 0
    for w in $WEAK_SECRETS; do
        [ "$value" = "$w" ] && return 0
    done
    len=${#value}
    [ "$len" -lt 32 ] && return 0
    return 1
}

generate_secret() {
    openssl rand -hex 32
}

# Human: Force-rotate one key in an env file (delete old lines, append new secret).
# Agent: MUTATES file in place via temp file; key must match ^KEY= after normalize.
rotate_key_in_file() {
    key="$1"
    file="$2"
    [ -f "$file" ] || return 0
    if ! grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null; then
        return 0
    fi
    line=$(grep -m1 -E "^[[:space:]]*${key}[[:space:]]*=" "$file")
    value=${line#*=}
    if is_weak "$value"; then
        secret=$(generate_secret)
        echo "  Fixing weak ${key} in ${file}"
        grep -vE "^[[:space:]]*${key}[[:space:]]*=" "$file" > "${file}.fix" || true
        printf '%s\n' "${key}=${secret}" >> "${file}.fix"
        mv "${file}.fix" "$file"
    fi
}

if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

echo "Checking $(pwd)/.env ..."
for key in JWT_SECRET SETUP_TOKEN SIGNING_SECRET NOS_JWT_SECRET NOS_SIGNING_SECRET; do
    rotate_key_in_file "$key" ".env"
done

# Human: Keep Nebular signing aligned with API after JWT_SECRET/SIGNING_SECRET rotation.
if [ -f .env ]; then
    signing=$(grep -m1 -E '^[[:space:]]*SIGNING_SECRET[[:space:]]*=' .env 2>/dev/null | cut -d= -f2- || true)
    signing=$(normalize_env_value "$signing")
    if [ -n "$signing" ] && grep -qE '^[[:space:]]*NOS_SIGNING_SECRET[[:space:]]*=' .env 2>/dev/null; then
        awk -v signing="$signing" '
            /^[[:space:]]*NOS_SIGNING_SECRET[[:space:]]*=/ { print "NOS_SIGNING_SECRET=" signing; next }
            { print }
        ' .env > .env.sync && mv .env.sync .env
    fi
fi

rotate_key_in_file "JWT_SECRET" "backend/.env"
rotate_key_in_file "SETUP_TOKEN" "backend/.env"
rotate_key_in_file "SIGNING_SECRET" "backend/.env"
rotate_key_in_file "OBJECT_STORAGE_JWT_SECRET" "backend/.env"

echo ""
echo "Done. Recreate API + frontend so Compose picks up SETUP_TOKEN:"
echo "  unset SETUP_TOKEN"
echo "  docker compose up -d --build --force-recreate backend frontend"
echo ""
echo "Verify (no secrets printed):"
echo "  sh scripts/verify-compose-secrets.sh"
