// Human: Block SSRF-style probes to private/internal hosts during setup connection tests.
// Agent: READS http(s) and postgres URLs; RETURNS AppError::BadRequest when target is reserved.

use std::net::IpAddr;

use crate::error::AppError;

// Human: Loopback and metadata hostnames that must never be probed from setup test routes.
// Agent: MATCHED before DNS; INCLUDES cloud metadata aliases.
const BLOCKED_HOSTNAMES: &[&str] = &[
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.goog",
];

// Human: True when setup may target RFC1918/link-local addresses (local dev without Docker).
// Agent: READ from Config.allow_private_outbound; DEFAULT false in production.
pub fn private_targets_allowed() -> bool {
    matches!(
        std::env::var("OWNLY_ALLOW_PRIVATE_OUTBOUND")
            .ok()
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
        Some("1") | Some("true") | Some("yes")
    )
}

// Human: Normalize a URL authority host for comparisons (lowercase, no trailing dot).
// Agent: STRIPS brackets from IPv6 literals; RETURNS trimmed host label.
fn normalize_host(host: &str) -> String {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if let Some(inner) = host.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        return inner.to_string();
    }
    host
}

// Human: True when an IP is loopback, private, link-local, or otherwise non-internet-routable.
// Agent: USED for literal IPs in URLs; COVERS IPv4 RFC1918 and IPv6 ULA/link-local.
fn is_non_public_ip(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}

// Human: Reject blocked hostnames and non-public literal IPs before outbound HTTP/storage probes.
// Agent: CALLED from setup storage test and storage node registration paths.
fn host_is_blocked(host: &str) -> bool {
    let host = normalize_host(host);
    if host.is_empty() {
        return true;
    }
    if BLOCKED_HOSTNAMES.iter().any(|blocked| host == *blocked) {
        return true;
    }
    if host.ends_with(".localhost") || host.ends_with(".local") {
        return true;
    }
    if let Ok(addr) = host.parse::<IpAddr>() {
        return is_non_public_ip(addr);
    }
    false
}

// Human: Parse scheme://host[:port]/… and return the host authority segment.
// Agent: SUPPORTS postgres and http(s); RETURNS BadRequest on malformed URLs.
fn extract_url_host(url: &str) -> Result<String, AppError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::BadRequest("URL is required".into()));
    }
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| AppError::BadRequest("unsupported URL scheme".into()))?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" && scheme != "postgres" && scheme != "postgresql" {
        return Err(AppError::BadRequest("unsupported URL scheme".into()));
    }
    let authority = rest
        .split(&['/', '?', '#'][..])
        .next()
        .unwrap_or(rest)
        .trim();
    if authority.is_empty() {
        return Err(AppError::BadRequest("URL host is required".into()));
    }
    let host = authority
        .rsplit_once('@')
        .map(|(_, host_port)| host_port)
        .unwrap_or(authority);
    let host = host
        .rsplit_once(':')
        .filter(|(h, port)| !h.contains(':') && port.chars().all(|c| c.is_ascii_digit()))
        .map(|(h, _)| h)
        .unwrap_or(host);
    Ok(host.to_string())
}

// Human: Gate outbound HTTP storage health probes against internal network ranges.
// Agent: RETURNS Err before reqwest when host is private/reserved and allow flag is off.
pub fn validate_http_outbound_base_url(base_url: &str) -> Result<(), AppError> {
    if private_targets_allowed() {
        return Ok(());
    }
    let host = extract_url_host(base_url)?;
    if host_is_blocked(&host) {
        return Err(AppError::BadRequest(
            "storage endpoint targets a private or internal address which is not allowed".into(),
        ));
    }
    Ok(())
}

// Human: Gate setup database connection tests against loopback and RFC1918 Postgres hosts.
// Agent: RETURNS Err before sqlx connect when host is blocked and allow flag is off.
pub fn validate_database_connection_url(database_url: &str) -> Result<(), AppError> {
    if private_targets_allowed() {
        return Ok(());
    }
    let host = extract_url_host(database_url)?;
    if host_is_blocked(&host) {
        return Err(AppError::BadRequest(
            "database URL targets a private or internal address which is not allowed".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_loopback_http() {
        assert!(validate_http_outbound_base_url("http://127.0.0.1:9000").is_err());
    }

    #[test]
    fn blocks_metadata_host() {
        assert!(validate_http_outbound_base_url("http://169.254.169.254").is_err());
    }

    #[test]
    fn allows_public_http() {
        assert!(validate_http_outbound_base_url("https://storage.example.com").is_ok());
    }

    #[test]
    fn blocks_private_postgres() {
        assert!(validate_database_connection_url("postgres://u:p@10.0.0.5:5432/db").is_err());
    }
}
