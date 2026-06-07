// Human: Redact secrets from connection strings returned by pre-setup info endpoints.
// Agent: MASKS password in postgres URLs; USED by setup_database_info (SEC-001).

const REDACTED_PASSWORD_PLACEHOLDER: &str = "***";

// Human: Non-secret parts of a postgres URL used to match wizard input against env DATABASE_URL.
// Agent: COMPARES scheme + user + host/port/db; IGNORES password segment.
#[derive(Debug, PartialEq, Eq)]
struct PostgresConnectionIdentity {
    scheme: String,
    user: String,
    tail: String,
}

// Human: Split postgres://user:pass@host:port/db into comparable identity parts.
// Agent: RETURNS None when URL shape is unsupported; NEVER logs password.
fn postgres_connection_identity(url: &str) -> Option<PostgresConnectionIdentity> {
    let url = url.trim().trim_end_matches('/');
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "postgres" && scheme != "postgresql" {
        return None;
    }
    let (userinfo, tail) = rest.split_once('@')?;
    let user = userinfo.split_once(':').map(|(u, _)| u).unwrap_or(userinfo);
    if user.is_empty() {
        return None;
    }
    Some(PostgresConnectionIdentity {
        scheme: scheme.to_string(),
        user: user.to_string(),
        tail: tail.to_string(),
    })
}

// Human: True when the wizard echoed the redacted placeholder or left password blank.
// Agent: ALLOWS resolve_setup_database_url to substitute env DATABASE_URL for zero-config Compose.
fn password_is_redacted_or_empty(url: &str) -> bool {
    let url = url.trim();
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    let Some((userinfo, _)) = rest.split_once('@') else {
        return true;
    };
    match userinfo.split_once(':') {
        None => true,
        Some((_, password)) => password.is_empty() || password == REDACTED_PASSWORD_PLACEHOLDER,
    }
}

// Human: Replace user:password@ with user:***@ so setup wizard keeps host/db fields.
// Agent: RETURNS original when no credentials segment; NEVER logs the input password.
pub fn redact_database_url(url: &str) -> String {
    let url = url.trim();
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    let Some((userinfo, tail)) = rest.split_once('@') else {
        return url.to_string();
    };
    let user = userinfo.split_once(':').map(|(u, _)| u).unwrap_or(userinfo);
    if user.is_empty() {
        return url.to_string();
    }
    format!("{scheme}://{user}:{REDACTED_PASSWORD_PLACEHOLDER}@{tail}")
}

// Human: Map wizard URLs that still carry the redacted placeholder back to env DATABASE_URL.
// Agent: USED by setup database test + complete handlers; RETURNS submitted when identity differs.
pub fn resolve_setup_database_url(submitted: &str, configured: &str) -> String {
    let submitted = submitted.trim();
    let configured = configured.trim();
    if submitted == configured {
        return configured.to_string();
    }
    let matches = postgres_connection_identity(submitted)
        .zip(postgres_connection_identity(configured))
        .map(|(a, b)| a == b)
        .unwrap_or(false);
    if matches && password_is_redacted_or_empty(submitted) {
        return configured.to_string();
    }
    submitted.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_postgres_password() {
        let redacted = redact_database_url("postgres://ownly:secret@postgres:5432/ownly");
        assert_eq!(redacted, "postgres://ownly:***@postgres:5432/ownly");
    }

    #[test]
    fn resolves_redacted_placeholder_to_configured_url() {
        let configured = "postgres://mediavault:real-secret@postgres:5432/mediavault";
        let submitted = "postgres://mediavault:***@postgres:5432/mediavault";
        assert_eq!(
            resolve_setup_database_url(submitted, configured),
            configured
        );
    }

    #[test]
    fn resolves_empty_password_to_configured_url() {
        let configured = "postgres://mediavault:real-secret@postgres:5432/mediavault";
        let submitted = "postgres://mediavault:@postgres:5432/mediavault";
        assert_eq!(
            resolve_setup_database_url(submitted, configured),
            configured
        );
    }

    #[test]
    fn keeps_custom_password_when_identity_differs() {
        let configured = "postgres://mediavault:real-secret@postgres:5432/mediavault";
        let submitted = "postgres://other:custom@postgres:5432/mediavault";
        assert_eq!(
            resolve_setup_database_url(submitted, configured),
            submitted
        );
    }
}
