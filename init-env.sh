#!/bin/sh
set -e

# Human: Values the API rejects at startup (must match backend/src/secrets.rs KNOWN_WEAK + GENERATE_ME).
# Agent: USED by is_weak_env_value and replace_weak_secret_keys before init-env exits.
WEAK_SECRETS="GENERATE_ME change-me-in-production change-me-in-production-jwt-secret dev-jwt-secret-change-me dev-nos-jwt-secret-change-me dev-nos-signing-secret-change-me ownly-master-key"

# Human: Strip CRLF, whitespace, and optional quotes from .env values.
# Agent: CALLED before weak/length checks so SETUP_TOKEN="GENERATE_ME" is still detected.
normalize_env_value() {
    printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

is_weak_env_value() {
    value=$(normalize_env_value "$1")
    [ -z "$value" ] && return 0
    for weak in $WEAK_SECRETS; do
        if [ "$value" = "$weak" ]; then
            return 0
        fi
    done
    return 1
}

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif command -v dd >/dev/null 2>&1; then
        dd if=/dev/urandom bs=1 count=32 2>/dev/null | od -An -tx1 | tr -d ' \n'
    else
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

init_env_file() {
    env_file="$1"
    example_file="$2"

    if [ ! -f "$example_file" ]; then
        echo "Error: $example_file not found"
        exit 1
    fi

    if [ ! -f "$env_file" ]; then
        echo "Creating $env_file from $example_file..."
        cp "$example_file" "$env_file"
    fi

    tmp_file="${env_file}.tmp"
    cp "$env_file" "$tmp_file"

    # Human: Replace one GENERATE_ME placeholder per loop (secrets are hex from openssl — safe for awk).
    # Agent: USES awk not perl so alpine:latest init-env container works without extra packages.
    while grep -q 'GENERATE_ME' "$tmp_file"; do
        secret="$(generate_secret)"
        awk -v secret="$secret" '
            !done && /GENERATE_ME/ { sub(/GENERATE_ME/, secret); done = 1 }
            { print }
        ' "$tmp_file" > "${tmp_file}.new" && mv "${tmp_file}.new" "$tmp_file"
    done

    mv "$tmp_file" "$env_file"

    # Human: Older .env files may still use code defaults (change-me-in-production) — rotate those too.
    # Agent: REPLACES weak values on named keys; CALLS generate_secret per weak key found.
    replace_weak_secret_keys() {
        keys="$1"
        file="$2"
        for key in $keys; do
            line=$(grep -m1 -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null || true)
            [ -z "$line" ] && continue
            value=${line#*=}
            if is_weak_env_value "$value"; then
                secret="$(generate_secret)"
                echo "  Rotating weak ${key} in ${file}"
                awk -v key="$key" -v secret="$secret" '
                    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
                        sub(/^[^=]*=/, key "=" secret)
                        print
                        next
                    }
                    { print }
                ' "$file" > "${file}.rotate" && mv "${file}.rotate" "$file"
            fi
        done
    }

    case "$env_file" in
        .env)
            replace_weak_secret_keys "JWT_SECRET SETUP_TOKEN SIGNING_SECRET NOS_JWT_SECRET NOS_SIGNING_SECRET" "$env_file"
            ;;
        backend/.env)
            replace_weak_secret_keys "JWT_SECRET SETUP_TOKEN SIGNING_SECRET OBJECT_STORAGE_JWT_SECRET" "$env_file"
            ;;
        nebular-os/.env)
            replace_weak_secret_keys "NOS_JWT_SECRET NOS_SIGNING_SECRET" "$env_file"
            ;;
    esac

    # Human: Fail loudly if placeholders remain so operators do not start a broken stack.
    # Agent: EXITS 1 when GENERATE_ME or weak secret still present on rotated keys.
    for key in JWT_SECRET SETUP_TOKEN SIGNING_SECRET NOS_JWT_SECRET NOS_SIGNING_SECRET OBJECT_STORAGE_JWT_SECRET; do
        line=$(grep -m1 -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" 2>/dev/null || true)
        [ -z "$line" ] && continue
        value=${line#*=}
        if is_weak_env_value "$value"; then
            echo "Error: ${env_file} still has weak ${key} (run init-env again or set a random value >= 32 chars)."
            exit 1
        fi
        value=$(normalize_env_value "$value")
        len=${#value}
        if [ "$len" -lt 32 ]; then
            echo "Error: ${env_file} ${key} is only ${len} characters (need >= 32)."
            exit 1
        fi
    done

    # Human: Nebular presigned URLs must use the same HMAC secret as ownly-backend (NOS_SIGNING_SECRET).
    # Agent: SYNC NOS_SIGNING_SECRET from SIGNING_SECRET when both exist in root .env (init used separate GENERATE_ME values).
    if [ "$env_file" = ".env" ]; then
        signing="$(grep '^SIGNING_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- || true)"
        if [ -n "$signing" ] && grep -q '^NOS_SIGNING_SECRET=' "$env_file" 2>/dev/null; then
            awk -v signing="$signing" '
                /^NOS_SIGNING_SECRET=/ { print "NOS_SIGNING_SECRET=" signing; next }
                { print }
            ' "$env_file" > "${env_file}.sync" && mv "${env_file}.sync" "$env_file"
        fi
        # Human: Backend container reads OBJECT_STORAGE_JWT_SECRET; Nebular uses NOS_JWT_SECRET.
        # Agent: SYNC from NOS_JWT_SECRET so env_file-only Compose does not need a duplicate manual line.
        nos_jwt="$(grep '^NOS_JWT_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- || true)"
        if [ -n "$nos_jwt" ]; then
            if grep -q '^OBJECT_STORAGE_JWT_SECRET=' "$env_file" 2>/dev/null; then
                awk -v nos_jwt="$nos_jwt" '
                    /^OBJECT_STORAGE_JWT_SECRET=/ { print "OBJECT_STORAGE_JWT_SECRET=" nos_jwt; next }
                    { print }
                ' "$env_file" > "${env_file}.jwt" && mv "${env_file}.jwt" "$env_file"
            else
                printf '%s\n' "OBJECT_STORAGE_JWT_SECRET=$nos_jwt" >> "$env_file"
            fi
        fi
    fi

    echo "$env_file is ready."
}

init_env_file ".env" ".env.example"
init_env_file "backend/.env" "backend/.env.example"
init_env_file "nebular-os/.env" "nebular-os/.env.example"
