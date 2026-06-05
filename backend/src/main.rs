// Human: Thin Tokio entrypoint that delegates startup, routing, and shutdown to `ownly_backend::run`.
// Agent: CALLS ownly_backend::run; RETURNS process exit via anyhow Result; CONFIG none here.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    ownly_backend::run().await
}
