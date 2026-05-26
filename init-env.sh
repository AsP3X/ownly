#!/bin/sh
set -e

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

    while grep -q 'GENERATE_ME' "$tmp_file"; do
        secret="$(generate_secret)"
        perl -i -pe "BEGIN { \$replaced = 0 } if (!\$replaced && /GENERATE_ME/) { s/GENERATE_ME/$secret/; \$replaced = 1; }" "$tmp_file"
    done

    mv "$tmp_file" "$env_file"

    # Human: Nebular presigned URLs must use the same HMAC secret as mediavault-backend (NOS_SIGNING_SECRET).
    # Agent: SYNC NOS_SIGNING_SECRET from SIGNING_SECRET when both exist in root .env (init used separate GENERATE_ME values).
    if [ "$env_file" = ".env" ]; then
        signing="$(grep '^SIGNING_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- || true)"
        if [ -n "$signing" ] && grep -q '^NOS_SIGNING_SECRET=' "$env_file" 2>/dev/null; then
            perl -i -pe "BEGIN { \$s = q{$signing} } if (/^NOS_SIGNING_SECRET=/) { \$_ = \"NOS_SIGNING_SECRET=\$s\\n\" }" "$env_file"
        fi
    fi

    echo "$env_file is ready."
}

init_env_file ".env" ".env.example"
init_env_file "backend/.env" "backend/.env.example"
init_env_file "nebular-os/.env" "nebular-os/.env.example"
