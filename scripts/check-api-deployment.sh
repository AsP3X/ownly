#!/bin/sh
# Human: Verify the live API matches the current frontend (drive + admin console routes).
# Agent: PROBES /version and key paths; EXPECTS 401 without JWT; 404 means stale backend image.
set -e

BASE="${1:-http://127.0.0.1:8080}"
API="${BASE%/}/api/v1"

probe() {
    method="$1"
    path="$2"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "${API}${path}")
    printf "  %-6s %-28s -> %s" "$method" "$path" "$code"
    case "$code" in
        401) echo " (ok — route exists, needs login)" ;;
        200|204) echo " (ok — public or allowed)" ;;
        404) echo " FAIL — route missing (rebuild backend from latest git)" ;;
        405) echo " FAIL — wrong method or old router (rebuild backend)" ;;
        502|503) echo " FAIL — backend down or nginx cannot reach it" ;;
        *) echo "" ;;
    esac
}

echo "API base: $API"
echo ""
echo "Version:"
curl -s "${API}/version" | tr ',' '\n' | sed 's/^/  /'
echo ""

if ! curl -s "${API}/version" | grep -q 'api_surface'; then
    echo "WARNING: api_surface missing — backend image is OLD (before drive/admin route bundle)."
    echo "         Run: git pull && docker compose build --no-cache backend"
    echo ""
fi

echo "Route probes (401 = good when logged-out):"
probe GET /dashboard
probe GET /folders
probe GET /jobs
probe POST /files/batch
probe GET /admin/overview
probe GET /admin/storage
probe GET /admin/security
probe GET "/admin/audit-logs?limit=1"
probe GET /admin/users/roles
echo ""
echo "If any line shows 404 or 405, recreate backend after rebuild:"
echo "  unset SETUP_TOKEN"
echo "  export GIT_SHA=\$(git rev-parse HEAD)"
echo "  docker compose build --no-cache backend"
echo "  docker compose up -d --force-recreate backend frontend"
