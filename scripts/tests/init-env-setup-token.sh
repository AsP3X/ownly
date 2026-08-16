#!/bin/sh
# Human: Regression — init-env must write one SETUP_TOKEN and Compose must interpolate it.
# Agent: RUN from repo root via `sh scripts/tests/init-env-setup-token.sh`; EXITS 1 on mismatch.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

echo "Checking docker-compose.yml interpolates SETUP_TOKEN from the host .env..."
if ! grep -qE 'SETUP_TOKEN:[[:space:]]*\$\{SETUP_TOKEN:-' docker-compose.yml; then
    echo "FAIL: docker-compose.yml must use \${SETUP_TOKEN:-...} so init-env values reach the API."
    exit 1
fi

if ! grep -qE 'SETUP_TOKEN:[[:space:]]*\$\{SETUP_TOKEN:\?' docker-compose.prod.yml; then
    echo "FAIL: docker-compose.prod.yml must require SETUP_TOKEN from .env / the environment."
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "SKIP init-env run (openssl not in PATH)."
    exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/backend" "$work/nebular-os"
cp "$root/.env.example" "$work/.env.example"
cp "$root/backend/.env.example" "$work/backend/.env.example"
cp "$root/nebular-os/.env.example" "$work/nebular-os/.env.example"
# Human: Windows checkouts may leave CRLF in examples — init-env must still produce a matching token.
printf 'SETUP_TOKEN=GENERATE_ME\r\nJWT_SECRET=GENERATE_ME\r\nSIGNING_SECRET=GENERATE_ME\r\nNOS_JWT_SECRET=GENERATE_ME\r\nNOS_SIGNING_SECRET=GENERATE_ME\r\n' > "$work/.env.example"
printf 'SETUP_TOKEN=GENERATE_ME\r\nJWT_SECRET=GENERATE_ME\r\nSIGNING_SECRET=GENERATE_ME\r\nOBJECT_STORAGE_JWT_SECRET=GENERATE_ME\r\n' > "$work/backend/.env.example"
printf 'NOS_JWT_SECRET=GENERATE_ME\r\nNOS_SIGNING_SECRET=GENERATE_ME\r\n' > "$work/nebular-os/.env.example"

cp "$root/init-env.sh" "$work/init-env.sh"
( cd "$work" && sh init-env.sh )

read_key() {
    file=$1
    key=$2
    line=$(grep -m1 -E "^[[:space:]]*${key}[[:space:]]*=" "$file")
    value=${line#*=}
    printf '%s' "$value" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

root_token=$(read_key "$work/.env" SETUP_TOKEN)
backend_token=$(read_key "$work/backend/.env" SETUP_TOKEN)

if [ -z "$root_token" ] || [ "$root_token" = "GENERATE_ME" ]; then
    echo "FAIL: init-env did not generate a SETUP_TOKEN in .env"
    exit 1
fi

if [ "$root_token" != "$backend_token" ]; then
    echo "FAIL: .env SETUP_TOKEN does not match backend/.env (wizard paste vs cargo run mismatch)."
    echo "  .env         = $root_token"
    echo "  backend/.env = $backend_token"
    exit 1
fi

echo "OK: Compose interpolates SETUP_TOKEN; init-env synced .env and backend/.env."
