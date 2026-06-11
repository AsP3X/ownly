// Human: Block SSRF-style probes to private/internal hosts during setup connection tests.
// Agent: READS http(s) and postgres URLs; RETURNS AppError::BadRequest when target is reserved.

use std::net::{IpAddr, ToSocketAddrs};

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

// Human: Map IPv4-mapped IPv6 literals to IPv4 for consistent private-range checks (SEC-020).
// Agent: CALLS to_ipv4_mapped; USED before is_non_public_ip.
fn normalize_ip(addr: IpAddr) -> IpAddr {
    match addr {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
        other => other,
    }
}

// Human: True when an IP is loopback, private, link-local, or otherwise non-internet-routable.
// Agent: USED for literal IPs in URLs; COVERS IPv4 RFC1918 and IPv6 ULA/link-local.
fn is_non_public_ip(addr: IpAddr) -> bool {
    let addr = normalize_ip(addr);
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

// Human: Resolve hostnames and reject when any A/AAAA record is non-public (SEC-020 DNS rebinding).
// Agent: USES std ToSocketAddrs in spawn_blocking; SKIPPED when private_targets_allowed.
async fn ensure_resolved_host_is_public(host: &str) -> Result<(), AppError> {
    if private_targets_allowed() {
        return Ok(());
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }

    let lookup_host = host.to_string();
    let lookup_target = lookup_host.clone();
    let addrs = tokio::task::spawn_blocking(move || {
        format!("{lookup_target}:0")
            .to_socket_addrs()
            .map(|iter| iter.map(|addr| addr.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|error| AppError::Internal(anyhow::anyhow!("dns lookup task failed: {error}")))?
    .map_err(|error| {
        AppError::BadRequest(format!(
            "could not resolve storage/database host '{lookup_host}': {error}"
        ))
    })?;

    if addrs.is_empty() {
        return Err(AppError::BadRequest(format!(
            "could not resolve host '{lookup_host}'"
        )));
    }

    for addr in addrs {
        if is_non_public_ip(addr) {
            return Err(AppError::BadRequest(
                "endpoint host resolves to a private or internal address which is not allowed"
                    .into(),
            ));
        }
    }
    Ok(())
}

// Human: Build reqwest client that does not follow redirects to internal targets (SEC-020).
// Agent: redirect::Policy::limited(0); USED by storage node probes.
pub fn outbound_probe_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(0))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

// Human: Gate outbound HTTP storage health probes against internal network ranges.
// Agent: RETURNS Err before reqwest when host is private/reserved and allow flag is off.
pub async fn validate_http_outbound_base_url(base_url: &str) -> Result<(), AppError> {
    if private_targets_allowed() {
        return Ok(());
    }
    let host = extract_url_host(base_url)?;
    if host_is_blocked(&host) {
        return Err(AppError::BadRequest(
            "storage endpoint targets a private or internal address which is not allowed".into(),
        ));
    }
    ensure_resolved_host_is_public(&host).await
}

// Human: Gate setup database connection tests against loopback and RFC1918 Postgres hosts.
// Agent: RETURNS Err before sqlx connect when host is blocked and allow flag is off.
pub async fn validate_database_connection_url(database_url: &str) -> Result<(), AppError> {
    if private_targets_allowed() {
        return Ok(());
    }
    let host = extract_url_host(database_url)?;
    if host_is_blocked(&host) {
        return Err(AppError::BadRequest(
            "database URL targets a private or internal address which is not allowed".into(),
        ));
    }
    ensure_resolved_host_is_public(&host).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn blocks_loopback_http_async() {
        assert!(
            validate_http_outbound_base_url("http://127.0.0.1:9000")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn blocks_metadata_host() {
        assert!(
            validate_http_outbound_base_url("http://169.254.169.254")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn allows_public_http() {
        assert!(
            validate_http_outbound_base_url("https://93.184.216.34")
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn blocks_private_postgres() {
        assert!(
            validate_database_connection_url("postgres://u:p@10.0.0.5:5432/db")
                .await
                .is_err()
        );
    }

    #[test]
    fn blocks_ipv4_mapped_loopback() {
        assert!(host_is_blocked("::ffff:127.0.0.1"));
    }
}
