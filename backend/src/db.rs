// Human: Connect to Postgres via SQLx, ensure the DB exists, and run migrations at startup.
// Agent: READS database_url; WRITES schema via Migrator; RETURNS PgPool; USES ./migrations/postgres.

use sqlx::postgres::PgPoolOptions;
use sqlx::migrate::{MigrateDatabase, Migrator};
use sqlx::PgPool;
use std::path::PathBuf;

// Human: Classify a connection string so setup UI picks the right driver family.
// Agent: READS url prefix; RETURNS "postgres" | None when unsupported.
pub fn driver_from_url(database_url: &str) -> Option<&'static str> {
    if database_url.starts_with("postgres://") || database_url.starts_with("postgresql://") {
        Some("postgres")
    } else {
        None
    }
}

// Human: Verify the URL is reachable and migrations apply without keeping a long-lived pool.
// Agent: CALLS init_pool; DISCONNECTS implicitly when pool drops; PROPAGATES migration errors.
pub async fn test_connection(database_url: &str) -> anyhow::Result<()> {
    let pool = init_pool(database_url).await?;
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok(())
}

// Human: Create the database cluster DB if missing, open a bounded pool, apply migrations once at startup.
// Agent: CALLS create_database for postgres URLs; RUNS migrations; DEFAULT max_connections 20.
pub async fn init_pool(database_url: &str) -> anyhow::Result<PgPool> {
    if !sqlx::Postgres::database_exists(database_url)
        .await
        .unwrap_or(false)
    {
        sqlx::Postgres::create_database(database_url).await?;
    }

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await?;

    let migrations_root = std::env::var("OWNLY_MIGRATIONS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations"));
    let migrations_dir = migrations_root.join("postgres");

    let migrator = Migrator::new(migrations_dir).await?;
    migrator.run(&pool).await?;

    Ok(pool)
}
