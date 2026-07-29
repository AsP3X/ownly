#!/usr/bin/env bash
# Human: Restore Ownly from a backup produced by scripts/backup-ownly.sh.
# Agent: VALIDATES MANIFEST + SHA256SUMS; RESTORES postgres.dump then nebular archives;
#        REQUIRES OWNLY_CONFIRM_RESTORE=yes to proceed (destructive).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: scripts/restore-ownly.sh --from DIR [options]

Restore PostgreSQL and Nebular object storage from an Ownly backup directory.

DANGER: Overwrites the current database and blob volumes.
Requires: OWNLY_CONFIRM_RESTORE=yes

Options:
  --from DIR           Backup directory (must contain MANIFEST.json)
  -f, --file FILE      Extra compose file (repeatable)
      --project NAME   Docker Compose project name (default: directory name)
      --db-only        Restore PostgreSQL only
      --blobs-only     Restore Nebular data only
      --skip-verify    Skip SHA256SUMS check
      --no-stop        Do not stop app services before restore (not recommended)
  -h, --help           Show this help

Examples:
  OWNLY_CONFIRM_RESTORE=yes ./scripts/restore-ownly.sh --from ./backups/ownly-20260729-120000
EOF
}

FROM=""
DB_ONLY=0
BLOBS_ONLY=0
SKIP_VERIFY=0
NO_STOP=0
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}"
COMPOSE_FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      FROM="${2:?}"
      shift 2
      ;;
    -f|--file)
      COMPOSE_FILES+=(-f "${2:?}")
      shift 2
      ;;
    --project)
      PROJECT="${2:?}"
      shift 2
      ;;
    --db-only)
      DB_ONLY=1
      shift
      ;;
    --blobs-only)
      BLOBS_ONLY=1
      shift
      ;;
    --skip-verify)
      SKIP_VERIFY=1
      shift
      ;;
    --no-stop)
      NO_STOP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$FROM" ]]; then
  echo "--from DIR is required" >&2
  usage >&2
  exit 2
fi

if [[ ! -d "$FROM" ]]; then
  echo "Backup directory not found: $FROM" >&2
  exit 1
fi

FROM="$(cd "$FROM" && pwd)"

if [[ "${OWNLY_CONFIRM_RESTORE:-}" != "yes" ]]; then
  echo "Refusing to restore: set OWNLY_CONFIRM_RESTORE=yes to confirm destructive overwrite." >&2
  exit 1
fi

if [[ "$DB_ONLY" -eq 1 && "$BLOBS_ONLY" -eq 1 ]]; then
  echo "Cannot combine --db-only and --blobs-only" >&2
  exit 2
fi

compose() {
  # Human: Bash 3.2 + set -u treats empty arrays as unbound — expand only when -f flags exist.
  if [[ ${#COMPOSE_FILES[@]} -gt 0 ]]; then
    COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" "$@"
  else
    COMPOSE_PROJECT_NAME="$PROJECT" docker compose "$@"
  fi
}

service_running() {
  local id
  id="$(compose ps -q "$1" 2>/dev/null || true)"
  [[ -n "$id" ]]
}

container_id() {
  compose ps -q "$1" 2>/dev/null || true
}

volume_for_mount() {
  local ctr="$1"
  local dest="$2"
  docker inspect -f \
    '{{range .Mounts}}{{if eq .Destination "'"$dest"'"}}{{.Name}}{{end}}{{end}}' \
    "$ctr" 2>/dev/null || true
}

POSTGRES_USER="${POSTGRES_USER:-ownly}"
POSTGRES_DB="${POSTGRES_DB:-ownly}"

echo "==> Ownly restore"
echo "    project: $PROJECT"
echo "    from:    $FROM"

if [[ ! -f "$FROM/MANIFEST.json" ]]; then
  echo "MANIFEST.json missing — not an Ownly backup directory" >&2
  exit 1
fi

if [[ "$SKIP_VERIFY" -eq 0 && -f "$FROM/SHA256SUMS" ]]; then
  echo "==> Verifying SHA256SUMS"
  (
    cd "$FROM"
    # Human: Only verify files that still exist (partial backups may omit components).
    while read -r hash path; do
      [[ -z "${path:-}" ]] && continue
      if [[ -f "$path" ]]; then
        echo "$hash  $path" | sha256sum -c -
      fi
    done <SHA256SUMS
  )
else
  echo "==> Skipping checksum verification"
fi

if [[ "$NO_STOP" -eq 0 ]]; then
  echo "==> Stopping application services (backend/frontend)"
  compose stop backend frontend 2>/dev/null || true
fi

# --- PostgreSQL -----------------------------------------------------------------
if [[ "$BLOBS_ONLY" -eq 0 ]]; then
  if [[ ! -f "$FROM/postgres.dump" ]]; then
    echo "postgres.dump missing in backup" >&2
    exit 1
  fi
  if ! service_running postgres; then
    echo "==> Starting postgres"
    compose up -d postgres
    # Wait for readiness
    for _ in $(seq 1 60); do
      if compose exec -T postgres pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi

  echo "==> Restoring PostgreSQL ($POSTGRES_DB)"
  compose exec -T postgres \
    psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
    >/dev/null || true
  compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
  compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
  # Human: Stream custom-format dump into pg_restore inside the container.
  compose exec -T postgres \
    pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl \
    <"$FROM/postgres.dump"
  echo "    database restored"
fi

# --- Nebular --------------------------------------------------------------------
restore_nebular_archive() {
  local service="$1"
  local archive="$2"
  local path="$FROM/$archive"

  if [[ ! -f "$path" ]]; then
    echo "Missing archive $archive" >&2
    return 1
  fi

  echo "==> Restoring $service from $archive"

  # Human: Ensure service exists and is stopped so SQLite/blob files are not open.
  compose stop "$service" 2>/dev/null || true
  if ! service_running "$service"; then
    compose up -d --no-start "$service" 2>/dev/null || compose create "$service" 2>/dev/null || true
  fi

  local ctr
  ctr="$(container_id "$service")"
  if [[ -z "$ctr" ]]; then
    # Create a stopped container to resolve volume
    compose up -d "$service"
    compose stop "$service"
    ctr="$(container_id "$service")"
  fi

  local vol
  vol="$(volume_for_mount "$ctr" "/data")"
  if [[ -z "$vol" ]]; then
    echo "Could not resolve /data volume for $service" >&2
    return 1
  fi

  docker run --rm \
    -v "$vol:/data" \
    -v "$FROM:/backup:ro" \
    alpine:3.20 \
    sh -c "rm -rf /data/blobs /data/meta /data/* 2>/dev/null; mkdir -p /data && tar xzf /backup/$archive -C /data"

  echo "    volume $vol restored"
}

if [[ "$DB_ONLY" -eq 0 ]]; then
  if [[ -f "$FROM/nebular-data.tar.gz" ]]; then
    restore_nebular_archive object-storage nebular-data.tar.gz
  else
    echo "nebular-data.tar.gz missing in backup" >&2
    exit 1
  fi

  if [[ -f "$FROM/nebular-extra-b-data.tar.gz" ]]; then
    if compose config --services 2>/dev/null | grep -qx object-storage-b; then
      restore_nebular_archive object-storage-b nebular-extra-b-data.tar.gz
    else
      echo "Warning: backup includes object-storage-b data but that service is not in compose config" >&2
    fi
  fi
fi

echo "==> Starting stack services"
compose up -d postgres object-storage
if compose config --services 2>/dev/null | grep -qx object-storage-b; then
  compose up -d object-storage-b 2>/dev/null || true
fi
compose up -d backend frontend 2>/dev/null || compose up -d backend 2>/dev/null || true

echo ""
echo "Restore complete from: $FROM"
echo "Verify: open the web UI, sign in, download a known file."
echo "If the API was rebuilt against a newer schema, migrations apply on backend start."
