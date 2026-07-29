#!/usr/bin/env bash
# Human: Full Ownly backup — PostgreSQL dump + Nebular object-storage data (+ optional secrets).
# Agent: REQUIRES running Compose postgres + object-storage (or host pg_dump / NEBULAR_DATA_DIR);
#        WRITES timestamped directory with MANIFEST.json, postgres.dump, nebular*.tar.gz, SHA256SUMS.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: scripts/backup-ownly.sh [options]

Create a full Ownly backup (database + object storage blobs/metadata).

Options:
  -o, --output DIR     Backup output directory (default: ./backups/ownly-YYYYMMDD-HHMMSS)
  -f, --file FILE      Extra compose file (repeatable), e.g. -f docker-compose.prod.yml
      --db-only        Backup PostgreSQL only
      --blobs-only     Backup Nebular data volumes only
      --include-secrets  Copy .env / backend/.env into the backup (sensitive)
      --project NAME   Docker Compose project name (default: directory name)
  -h, --help           Show this help

Environment:
  COMPOSE_PROJECT_NAME   Same as --project
  POSTGRES_USER          Default: ownly
  POSTGRES_DB            Default: ownly
  DATABASE_URL           Optional host-side pg_dump when postgres container is down
  NEBULAR_DATA_DIR       Optional host path to Nebular /data when container is down

Examples:
  ./scripts/backup-ownly.sh
  ./scripts/backup-ownly.sh -o /mnt/backups/ownly-weekly --include-secrets
  ./scripts/backup-ownly.sh -f docker-compose.yml -f docker-compose.prod.yml
EOF
}

OUTPUT=""
DB_ONLY=0
BLOBS_ONLY=0
INCLUDE_SECRETS=0
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}"
COMPOSE_FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output)
      OUTPUT="${2:?}"
      shift 2
      ;;
    -f|--file)
      COMPOSE_FILES+=(-f "${2:?}")
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
    --include-secrets)
      INCLUDE_SECRETS=1
      shift
      ;;
    --project)
      PROJECT="${2:?}"
      shift 2
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

if [[ "$DB_ONLY" -eq 1 && "$BLOBS_ONLY" -eq 1 ]]; then
  echo "Cannot combine --db-only and --blobs-only" >&2
  exit 2
fi

if [[ -z "$OUTPUT" ]]; then
  OUTPUT="$ROOT/backups/ownly-$(date -u +%Y%m%d-%H%M%S)"
fi

mkdir -p "$OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"

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
  # Human: Resolve the Docker volume name mounted at DEST inside a running container.
  local ctr="$1"
  local dest="$2"
  docker inspect -f \
    '{{range .Mounts}}{{if eq .Destination "'"$dest"'"}}{{.Name}}{{end}}{{end}}' \
    "$ctr" 2>/dev/null || true
}

file_size() {
  if [[ -f "$1" ]]; then
    wc -c <"$1" | tr -d ' '
  else
    echo 0
  fi
}

echo "==> Ownly backup"
echo "    project: $PROJECT"
echo "    output:  $OUTPUT"

POSTGRES_USER="${POSTGRES_USER:-ownly}"
POSTGRES_DB="${POSTGRES_DB:-ownly}"
PG_DUMP_FILE="$OUTPUT/postgres.dump"
MANIFEST="$OUTPUT/MANIFEST.json"
SHA_FILE="$OUTPUT/SHA256SUMS"
: >"$SHA_FILE"

# --- PostgreSQL -----------------------------------------------------------------
if [[ "$BLOBS_ONLY" -eq 0 ]]; then
  echo "==> Backing up PostgreSQL ($POSTGRES_DB)"
  if service_running postgres; then
    compose exec -T postgres \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl \
      >"$PG_DUMP_FILE"
  elif [[ -n "${DATABASE_URL:-}" ]]; then
    if ! command -v pg_dump >/dev/null 2>&1; then
      echo "pg_dump not found and postgres container is not running" >&2
      exit 1
    fi
    pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl >"$PG_DUMP_FILE"
  else
    echo "Postgres container is not running and DATABASE_URL is unset" >&2
    exit 1
  fi
  echo "    wrote $(file_size "$PG_DUMP_FILE") bytes -> postgres.dump"
  (
    cd "$OUTPUT"
    sha256sum postgres.dump >>SHA256SUMS
  )
fi

# --- Nebular object storage -----------------------------------------------------
backup_nebular_service() {
  local service="$1"
  local archive_name="$2"
  local ctr
  ctr="$(container_id "$service")"
  if [[ -z "$ctr" ]]; then
    return 1
  fi

  echo "==> Backing up $service data volume"
  # Human: Stream tar from inside the container so Compose project volume names do not matter.
  # Agent: Includes /data/blobs and /data/meta (metadata.db) required for Nebular restore.
  if docker exec "$ctr" tar czf - -C /data . >"$OUTPUT/$archive_name" 2>/dev/null; then
    :
  else
    # Human: Fallback via alpine + volume mount when tar is missing in the image.
    local vol
    vol="$(volume_for_mount "$ctr" "/data")"
    if [[ -z "$vol" ]]; then
      echo "Could not resolve /data volume for $service" >&2
      return 1
    fi
    docker run --rm \
      -v "$vol:/data:ro" \
      -v "$OUTPUT:/backup" \
      alpine:3.20 \
      tar czf "/backup/$archive_name" -C /data .
  fi
  echo "    wrote $(file_size "$OUTPUT/$archive_name") bytes -> $archive_name"
  (
    cd "$OUTPUT"
    sha256sum "$archive_name" >>SHA256SUMS
  )
  return 0
}

NEBULAR_ARCHIVES=()
if [[ "$DB_ONLY" -eq 0 ]]; then
  if backup_nebular_service object-storage nebular-data.tar.gz; then
    NEBULAR_ARCHIVES+=("nebular-data.tar.gz")
  elif [[ -n "${NEBULAR_DATA_DIR:-}" && -d "$NEBULAR_DATA_DIR" ]]; then
    echo "==> Backing up NEBULAR_DATA_DIR=$NEBULAR_DATA_DIR"
    tar czf "$OUTPUT/nebular-data.tar.gz" -C "$NEBULAR_DATA_DIR" .
    NEBULAR_ARCHIVES+=("nebular-data.tar.gz")
    echo "    wrote $(file_size "$OUTPUT/nebular-data.tar.gz") bytes -> nebular-data.tar.gz"
    (
      cd "$OUTPUT"
      sha256sum nebular-data.tar.gz >>SHA256SUMS
    )
  else
    echo "object-storage is not running and NEBULAR_DATA_DIR is unset/invalid" >&2
    exit 1
  fi

  # Human: Optional second standalone node from docker-compose.rep.yml.
  if service_running object-storage-b; then
    if backup_nebular_service object-storage-b nebular-extra-b-data.tar.gz; then
      NEBULAR_ARCHIVES+=("nebular-extra-b-data.tar.gz")
    fi
  fi
fi

# --- Optional secrets -----------------------------------------------------------
SECRETS_INCLUDED=false
if [[ "$INCLUDE_SECRETS" -eq 1 ]]; then
  echo "==> Including env secrets (treat this backup as confidential)"
  mkdir -p "$OUTPUT/secrets"
  for f in .env backend/.env; do
    if [[ -f "$ROOT/$f" ]]; then
      cp "$ROOT/$f" "$OUTPUT/secrets/$(basename "$f")"
      SECRETS_INCLUDED=true
    fi
  done
  if [[ "$SECRETS_INCLUDED" == true ]]; then
    (
      cd "$OUTPUT"
      # shellcheck disable=SC2038
      find secrets -type f | sort | while read -r path; do
        sha256sum "$path" >>SHA256SUMS
      done
    )
  else
    echo "    no .env files found (Compose may use baked-in secrets)"
  fi
fi

# --- Manifest -------------------------------------------------------------------
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export CREATED_AT PROJECT GIT_SHA POSTGRES_DB POSTGRES_USER SECRETS_INCLUDED
CREATED_AT="$CREATED_AT" PROJECT="$PROJECT" GIT_SHA="$GIT_SHA" \
  POSTGRES_DB="$POSTGRES_DB" POSTGRES_USER="$POSTGRES_USER" \
  SECRETS_INCLUDED="$SECRETS_INCLUDED" \
  python3 - "$MANIFEST" <<'PY'
import json, os, sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
out = manifest_path.parent
env = os.environ

archives = []
for name in sorted(out.glob("nebular*.tar.gz")):
    archives.append({"file": name.name, "bytes": name.stat().st_size})

pg = out / "postgres.dump"
payload = {
    "format_version": 1,
    "kind": "ownly-full-backup",
    "created_at": env.get("CREATED_AT"),
    "compose_project": env.get("PROJECT"),
    "git_sha": env.get("GIT_SHA"),
    "hostname": os.uname().nodename if hasattr(os, "uname") else None,
    "components": {
        "postgres": {
            "included": pg.is_file(),
            "file": "postgres.dump" if pg.is_file() else None,
            "bytes": pg.stat().st_size if pg.is_file() else 0,
            "format": "pg_dump -Fc",
            "database": env.get("POSTGRES_DB", "ownly"),
            "user": env.get("POSTGRES_USER", "ownly"),
        },
        "nebular": {
            "included": bool(archives),
            "archives": archives,
        },
        "secrets": {
            "included": env.get("SECRETS_INCLUDED") == "true",
            "path": "secrets/" if env.get("SECRETS_INCLUDED") == "true" else None,
        },
    },
    "restore": {
        "script": "scripts/restore-ownly.sh",
        "docs": "docs/backup-restore.md",
    },
}
manifest_path.write_text(json.dumps(payload, indent=2) + "\n")
print(f"    wrote manifest -> {manifest_path.name}")
PY

(
  cd "$OUTPUT"
  sha256sum MANIFEST.json >>SHA256SUMS
)

echo ""
echo "Backup complete: $OUTPUT"
echo "  MANIFEST.json  SHA256SUMS"
[[ -f "$PG_DUMP_FILE" ]] && echo "  postgres.dump"
for a in "${NEBULAR_ARCHIVES[@]:-}"; do
  echo "  $a"
done
echo ""
echo "Restore with:  ./scripts/restore-ownly.sh --from \"$OUTPUT\""
echo "Docs:          docs/backup-restore.md"
