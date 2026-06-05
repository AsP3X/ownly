// Human: Reject committed defaults and short secrets before the API accepts traffic or signs JWTs.
// Agent: READS Config secret fields; RETURNS Err on weak/short values; CALLED from create_app_state and run.

use crate::config::Config;

pub const MIN_SECRET_LEN: usize = 32;

const KNOWN_WEAK_SECRETS: &[&str] = &[
    "change-me-in-production",
    "change-me-in-production-jwt-secret",
    "dev-jwt-secret-change-me",
    "dev-nos-jwt-secret-change-me",
    "dev-nos-signing-secret-change-me",
    "ownly-master-key",
];

// Human: True when the value is empty, an init placeholder, or a known weak default from code or compose.
// Agent: TRIMS input; MATCHES KNOWN_WEAK_SECRETS or GENERATE_ME; NO side effects.
pub fn is_weak_secret(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty()
        || trimmed == "GENERATE_ME"
        || KNOWN_WEAK_SECRETS.contains(&trimmed)
}

// Human: Operator-facing hint without echoing the secret value.
// Agent: RETURNS static reason when is_weak_secret; used in validate_field error text.
fn weak_secret_reason(env_name: &str, value: &str) -> Option<&'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Some(
            "empty — recreate backend with `docker compose up -d --force-recreate backend` (Compose must inject SETUP_TOKEN)",
        );
    }
    if trimmed == "GENERATE_ME" {
        return Some("still GENERATE_ME — run `docker compose --profile init run --rm init-env`");
    }
    if KNOWN_WEAK_SECRETS.contains(&trimmed) {
        if trimmed == "change-me-in-production" && env_name == "SETUP_TOKEN" {
            return Some(
                "missing from container — run `git pull`, then `docker compose up -d --build --force-recreate backend frontend`; \
                 check `docker compose config | grep SETUP_TOKEN` shows the compose literal, not empty",
            );
        }
        return Some(
            "known weak default (e.g. change-me-in-production) — replace with `openssl rand -hex 32`",
        );
    }
    None
}

// Human: Fail fast with a field name so operators know which env var to fix.
// Agent: CALLS is_weak_secret + length check; BAILS with anyhow message naming env var.
fn validate_field(env_name: &str, value: &str) -> anyhow::Result<()> {
    if is_weak_secret(value) {
        let hint = weak_secret_reason(env_name, value).unwrap_or("invalid placeholder or default");
        anyhow::bail!(
            "{env_name} rejected at startup: {hint}. \
             Need at least {MIN_SECRET_LEN} random characters. \
             On the server: `sh scripts/verify-compose-secrets.sh` then `docker compose up -d --build --force-recreate backend frontend`."
        );
    }
    if value.len() < MIN_SECRET_LEN {
        anyhow::bail!(
            "{env_name} must be at least {MIN_SECRET_LEN} characters (got {}).",
            value.len()
        );
    }
    Ok(())
}

// Human: Gate startup so weak JWT/signing/NOS secrets cannot serve requests.
// Agent: VALIDATES jwt_secret, signing_secret, object_storage_jwt_secret on Config.
pub fn validate_startup_secrets(config: &Config) -> anyhow::Result<()> {
    validate_field("JWT_SECRET", &config.jwt_secret)?;
    validate_field("SETUP_TOKEN", &config.setup_token)?;
    validate_field("SIGNING_SECRET", &config.signing_secret)?;
    validate_field("OBJECT_STORAGE_JWT_SECRET", &config.object_storage_jwt_secret)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_weak_defaults() {
        for weak in KNOWN_WEAK_SECRETS {
            assert!(is_weak_secret(weak), "expected weak: {weak}");
        }
        assert!(is_weak_secret("GENERATE_ME"));
    }

    #[test]
    fn compose_dev_setup_token_is_acceptable() {
        use crate::config::COMPOSE_DEV_SETUP_TOKEN;
        assert!(!is_weak_secret(COMPOSE_DEV_SETUP_TOKEN));
        assert!(COMPOSE_DEV_SETUP_TOKEN.len() >= MIN_SECRET_LEN);
    }

    #[test]
    fn weak_reason_for_placeholder() {
        assert!(weak_secret_reason("SETUP_TOKEN", "GENERATE_ME").is_some());
        assert!(weak_secret_reason("SETUP_TOKEN", "change-me-in-production").is_some());
        assert!(weak_secret_reason("SETUP_TOKEN", "").is_some());
        let good = "a".repeat(40);
        assert!(weak_secret_reason("SETUP_TOKEN", &good).is_none());
    }
}
