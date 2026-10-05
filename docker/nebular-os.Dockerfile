# Human: Ownly Compose build for Nebular OS v0.2.x — tracks upstream Dockerfile (unprivileged `nos` user, rustls only).
# Agent: CONTEXT is ./nebular-os; SYNC on submodule bump; HEALTHCHECK uses GET /health/ready.
FROM rust:1.88-slim-bookworm AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        pkg-config \
        libssl-dev \
        libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml .
COPY Cargo.lock .
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
# Human: Postgres metadata backend embeds SQL at compile time (migrations/*.sql).
# Agent: COPY migrations for include_str in src/storage/object_meta.rs; SYNC on submodule bump.
COPY migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
# Human: curl is required for Docker / Compose health probes; HTTPS to peers/webhooks uses rustls (no OpenSSL).
# Agent: INSTALL ca-certificates + curl; HEALTHCHECK hits GET /health/ready on NOS_BIND_ADDR.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# Human: The server runs as `nos` (uid/gid 10001); the entrypoint starts as root only to hand /data to that user
# (volumes written by pre-0.2 images are root-owned) and then drops privileges with setpriv.
# Agent: NOS_DATA_DIR / NOS_META_PATH default under /data; Compose sets the same values explicitly.
RUN groupadd --system --gid 10001 nos \
    && useradd --system --uid 10001 --gid nos --home-dir /data --no-create-home --shell /usr/sbin/nologin nos \
    && mkdir -p /app /data \
    && chown nos:nos /app /data
ENV NOS_DATA_DIR=/data/blobs \
    NOS_META_PATH=/data/meta/metadata.db
WORKDIR /app
COPY --from=builder /app/target/release/nebular-os /usr/local/bin/nebular-os
COPY docker/entrypoint.sh /entrypoint.sh
# Human: Windows checkouts (core.autocrlf) turn the entrypoint into CRLF, which /bin/sh cannot run.
# Agent: STRIPS \r before chmod; NO-OP on LF checkouts.
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 0755 /entrypoint.sh
EXPOSE 9000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:9000/health/ready" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
