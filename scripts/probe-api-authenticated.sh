#!/bin/sh
# Human: Test drive/admin API paths with a real JWT (same as the browser after login).
# Agent: POST /auth/login; PROBES paths with Bearer token; PRINTS HTTP codes only.
set -e

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <admin-email> <password> [base-url]"
    echo "Example: $0 admin@example.com 'your-pass' http://corespace.de:8089"
    exit 1
fi

EMAIL="$1"
PASS="$2"
BASE="${3:-http://127.0.0.1:8080}"
API="${BASE%/}/api/v1"

login_body=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASS")
login_json=$(curl -s -X POST "${API}/auth/login" \
    -H "Content-Type: application/json" \
    -d "$login_body")

TOKEN=""
if command -v python3 >/dev/null 2>&1; then
    TOKEN=$(printf '%s' "$login_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token') or '')" 2>/dev/null || true)
fi
if [ -z "$TOKEN" ]; then
    TOKEN=$(printf '%s' "$login_json" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi

if [ -z "$TOKEN" ]; then
    echo "Login failed. Response:"
    echo "$login_json"
    exit 1
fi

ROLE=""
if command -v python3 >/dev/null 2>&1; then
    ROLE=$(printf '%s' "$login_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('user') or {}).get('role',''))" 2>/dev/null || true)
fi
echo "Login OK (role=${ROLE:-unknown})"
echo ""

probe() {
    method="$1"
    path="$2"
    body="${3:-}"
    if [ -n "$body" ]; then
        code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "$body" \
            "${API}${path}")
    else
        code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            "${API}${path}")
    fi
    printf "  %-6s %-32s -> %s\n" "$method" "$path" "$code"
}

echo "Authenticated probes:"
probe GET /me
probe GET /dashboard
probe GET /folders
probe GET /jobs
probe POST /files/batch '{"ids":[]}'
probe GET /admin/overview
probe GET /admin/storage
probe GET /admin/security
probe GET "/admin/audit-logs?limit=5"
probe GET /admin/users/roles
probe GET /admin/users
probe GET /admin/settings
echo ""
echo "Expected: 200 (or 204) on most lines for an admin account."
echo "403 = logged in but not admin. 404/405 = stale frontend/proxy or old image still serving some paths."
