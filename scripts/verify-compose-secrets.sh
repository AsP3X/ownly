#!/bin/sh
# Human: Operator checklist — shows whether Compose will inject weak SETUP_TOKEN/JWT values.
# Agent: READS .env and `docker compose config`; NO secrets printed (length + weak hint only).

set -e
cd "$(dirname "$0")/.."

is_weak_hint() {
    value="$1"
    case "$value" in
        "" | GENERATE_ME | change-me-in-production | change-me-in-production-jwt-secret \
        | dev-jwt-secret-change-me | dev-nos-jwt-secret-change-me \
        | dev-nos-signing-secret-change-me | mediavault-master-key)
            echo "WEAK"
            ;;
        *)
            len=${#value}
            if [ "$len" -lt 32 ]; then
                echo "SHORT(${len})"
            else
                echo "ok"
            fi
            ;;
    esac
}

echo "Working directory: $(pwd)"
echo ""

if [ -f .env ]; then
    echo "Root .env secret lines (status only):"
    for key in JWT_SECRET SETUP_TOKEN SIGNING_SECRET NOS_JWT_SECRET NOS_SIGNING_SECRET; do
        line=$(grep -m1 "^${key}=" .env 2>/dev/null || true)
        if [ -z "$line" ]; then
            echo "  ${key}: (missing — Compose may use docker-compose.yml default)"
            continue
        fi
        value=${line#*=}
        echo "  ${key}: $(is_weak_hint "$value")"
    done
else
    echo "No .env in project root — Compose uses defaults from docker-compose.yml."
fi

echo ""
if [ -n "${SETUP_TOKEN:-}" ]; then
    echo "WARNING: SETUP_TOKEN is set in your shell (overrides .env for docker compose)."
    echo "  Shell SETUP_TOKEN status: $(is_weak_hint "$SETUP_TOKEN")"
    echo "  Fix: unset SETUP_TOKEN   # then re-run docker compose up"
    echo ""
fi

if command -v docker >/dev/null 2>&1; then
    echo "Resolved backend SETUP_TOKEN (from docker compose config):"
    resolved=$(docker compose config 2>/dev/null | awk '
        /^  backend:/ { in_backend=1; next }
        in_backend && /^  [a-z]/ { in_backend=0 }
        in_backend && /^      SETUP_TOKEN:/ { print $2; exit }
    ' || true)
    if [ -n "$resolved" ]; then
        echo "  SETUP_TOKEN: $(is_weak_hint "$resolved")"
    else
        echo "  (could not parse — run: docker compose config | grep -A2 backend)"
    fi
else
    echo "docker not in PATH — skip compose config check."
fi

echo ""
echo "If SETUP_TOKEN is WEAK or SHORT, run:"
echo "  docker compose --profile init run --rm init-env"
echo "  docker compose up -d --build"
