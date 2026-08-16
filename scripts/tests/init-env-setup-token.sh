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
printf 'DATABASE_URL=postgres://ownly:ownly-compose-local-dev-postgres-password-not-for-production@postgres:5432/ownly\r\nPOSTGRES_USER=ownly\r\nPOSTGRES_PASSWORD=GENERATE_ME\r\nPOSTGRES_DB=ownly\r\nSETUP_TOKEN=GENERATE_ME\r\nJWT_SECRET=GENERATE_ME\r\nSIGNING_SECRET=GENERATE_ME\r\nNOS_JWT_SECRET=GENERATE_ME\r\nNOS_SIGNING_SECRET=GENERATE_ME\r\n' > "$work/.env.example"
printf 'DATABASE_URL=postgres://ownly:ownly@postgres:5432/ownly\r\nSETUP_TOKEN=GENERATE_ME\r\nJWT_SECRET=GENERATE_ME\r\nSIGNING_SECRET=GENERATE_ME\r\nOBJECT_STORAGE_JWT_SECRET=GENERATE_ME\r\n' > "$work/backend/.env.example"
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

root_pg=$(read_key "$work/.env" POSTGRES_PASSWORD)
root_db=$(read_key "$work/.env" DATABASE_URL)
backend_db=$(read_key "$work/backend/.env" DATABASE_URL)

if [ -z "$root_pg" ] || [ "$root_pg" = "GENERATE_ME" ] \
    || [ "$root_pg" = "ownly-compose-local-dev-postgres-password-not-for-production" ] \
    || [ "$root_pg" = "ownly" ]; then
    echo "FAIL: init-env did not generate a random POSTGRES_PASSWORD in .env"
    exit 1
fi

pg_len=${#root_pg}
if [ "$pg_len" -lt 32 ]; then
    echo "FAIL: POSTGRES_PASSWORD is only ${pg_len} characters (need >= 32)."
    exit 1
fi

case "$root_db" in
    *"//ownly:${root_pg}@"*) ;;
    *)
        echo "FAIL: .env DATABASE_URL password does not match POSTGRES_PASSWORD."
        echo "  POSTGRES_PASSWORD = $root_pg"
        echo "  DATABASE_URL      = $root_db"
        exit 1
        ;;
esac

if [ "$root_db" != "$backend_db" ]; then
    echo "FAIL: .env DATABASE_URL does not match backend/.env"
    echo "  .env         = $root_db"
    echo "  backend/.env = $backend_db"
    exit 1
fi

echo "OK: Compose interpolates SETUP_TOKEN; init-env synced .env and backend/.env."
echo "OK: init-env generated POSTGRES_PASSWORD and rewrote DATABASE_URL."

work2=$(mktemp -d)
trap 'rm -rf "$work" "$work2"' EXIT
mkdir -p "$work2/backend" "$work2/nebular-os"
cp "$root/.env.example" "$work2/.env.example"
cp "$root/backend/.env.example" "$work2/backend/.env.example"
cp "$root/nebular-os/.env.example" "$work2/nebular-os/.env.example"
cp "$root/init-env.sh" "$work2/init-env.sh"
( cd "$work2" && sh init-env.sh >/dev/null )
real_pg=$(read_key "$work2/.env" POSTGRES_PASSWORD)
real_db=$(read_key "$work2/.env" DATABASE_URL)
real_backend_db=$(read_key "$work2/backend/.env" DATABASE_URL)
if [ "$real_pg" = "GENERATE_ME" ] || [ "$real_pg" = "ownly-compose-local-dev-postgres-password-not-for-production" ]; then
    echo "FAIL: init-env left a weak POSTGRES_PASSWORD when started from the real .env.example"
    exit 1
fi
case "$real_db" in
    *"//ownly:${real_pg}@"*) ;;
    *)
        echo "FAIL: real .env.example run did not put POSTGRES_PASSWORD into DATABASE_URL."
        exit 1
        ;;
esac
if [ "$real_db" != "$real_backend_db" ]; then
    echo "FAIL: real .env.example run did not sync DATABASE_URL to backend/.env"
    exit 1
fi
echo "OK: init-env from the real .env.example generated and synced the database password."
