// Human: Redact secrets from connection strings returned by pre-setup info endpoints.
// Agent: MASKS password in postgres URLs; USED by setup_database_info (SEC-001).

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
    format!("{scheme}://{user}:***@{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_postgres_password() {
        let redacted = redact_database_url("postgres://ownly:secret@postgres:5432/ownly");
        assert_eq!(redacted, "postgres://ownly:***@postgres:5432/ownly");
    }
}
