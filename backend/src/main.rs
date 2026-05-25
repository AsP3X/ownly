// Human: Thin Tokio entrypoint that delegates startup, routing, and shutdown to `mediavault_backend::run`.
// Agent: CALLS mediavault_backend::run; RETURNS process exit via anyhow Result; CONFIG none here.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    mediavault_backend::run().await
}
