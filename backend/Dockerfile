FROM rust:1.88-slim-bookworm AS builder

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN apt-get update && apt-get install -y libssl-dev pkg-config && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
COPY migrations ./migrations

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl3 ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/mediavault-backend /app/mediavault-backend
COPY --from=builder /app/migrations /app/migrations

EXPOSE 3000

CMD ["./mediavault-backend"]
