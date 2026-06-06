// Human: Reject cross-site scripts on register and admin user creation (not POST /setup).
// Agent: READS Sec-Fetch-Site, Origin, Referer, Host, X-Forwarded-*; CALLED from register and admin create_user.

use axum::http::HeaderMap;

use crate::error::AppError;

/// Human: Fetch Metadata header browsers send on SPA requests; absent on some reverse proxies.
/// Agent: MATCHED in require_browser_user_creation when present.
pub const SEC_FETCH_SITE: &str = "Sec-Fetch-Site";

// Human: Parsed scheme/host/port for comparing SPA origin against the API request target.
// Agent: BUILT from Origin/Referer and from Host + X-Forwarded-Proto on the inbound request.
#[derive(Debug, Clone)]
struct SiteKey {
    scheme: String,
    host: String,
    port: Option<u16>,
}

impl SiteKey {
    // Human: Default ports so http://host and http://host:80 compare equal.
    // Agent: USED by sites_match; RETURNS 80/443 when port omitted.
    fn effective_port(&self) -> u16 {
        self.port.unwrap_or_else(|| {
            if self.scheme == "https" {
                443
            } else {
                80
            }
        })
    }
}

// Human: Compare scheme, host, and effective port so default HTTP/HTTPS ports still match.
// Agent: USED instead of derived Eq; NORMALIZES omitted ports to 80/443.
fn sites_match(a: &SiteKey, b: &SiteKey) -> bool {
    a.scheme == b.scheme
        && a.host == b.host
        && a.effective_port() == b.effective_port()
}

// Human: Lowercase host labels and strip accidental trailing dots from DNS names.
// Agent: NORMALIZES Host / Origin host parts before equality checks.
fn normalize_host(host: &str) -> String {
    host.trim().trim_end_matches('.').to_ascii_lowercase()
}

// Human: Split host:port authority from Host or Origin host segments.
// Agent: RETURNS (host, optional port); IPv6 bracket form is not required for Ownly deployments.
fn split_host_port(authority: &str) -> Option<(String, Option<u16>)> {
    let authority = authority.trim();
    if authority.is_empty() {
        return None;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port_str)) if !host.contains(':') => {
            let port = port_str.parse::<u16>().ok()?;
            (host, Some(port))
        }
        _ => (authority, None),
    };
    let host = normalize_host(host);
    if host.is_empty() {
        return None;
    }
    Some((host, port))
}

// Human: Build a site key from scheme plus host[:port] authority text.
// Agent: USED for Host / X-Forwarded-Host comparison against Origin.
fn site_key_from_authority(scheme: &str, authority: &str) -> Option<SiteKey> {
    let scheme = scheme.trim().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let (host, port) = split_host_port(authority)?;
    Some(SiteKey { scheme, host, port })
}

// Human: Parse Origin header value (scheme://host[:port] only).
// Agent: RETURNS SiteKey; REJECTS paths or opaque origins.
fn site_key_from_origin_header(value: &str) -> Option<SiteKey> {
    let value = value.trim();
    let (scheme, rest) = value.split_once("://")?;
    let authority = rest.split('/').next()?.trim();
    if authority.is_empty() {
        return None;
    }
    site_key_from_authority(scheme, authority)
}

// Human: Derive site key from Referer when Origin is omitted (older browsers / some proxies).
// Agent: STRIPS path/query; USES origin portion only.
fn site_key_from_referer_header(value: &str) -> Option<SiteKey> {
    site_key_from_origin_header(value.trim())
}

// Human: Public site the API believes it is serving — respects reverse-proxy forwarded headers.
// Agent: READS x-forwarded-proto + x-forwarded-host (first hop) or Host; RETURNS SiteKey.
fn request_site_from_headers(headers: &HeaderMap) -> Option<SiteKey> {
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("http");

    let host_value = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    let authority = host_value.split(',').next()?.trim();
    site_key_from_authority(scheme, authority)
}

// Human: True when Origin or Referer matches the request Host / forwarded public origin.
// Agent: ALLOWS same-host SPA traffic when Sec-Fetch-Site was stripped by nginx or TLS proxies.
fn origin_matches_request_site(headers: &HeaderMap) -> bool {
    let Some(request_site) = request_site_from_headers(headers) else {
        return false;
    };

    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        if let Some(origin_site) = site_key_from_origin_header(origin) {
            return sites_match(&origin_site, &request_site);
        }
    }

    if let Some(referer) = headers.get("referer").and_then(|v| v.to_str().ok()) {
        if let Some(referer_site) = site_key_from_referer_header(referer) {
            return sites_match(&referer_site, &request_site);
        }
    }

    false
}

// Human: Only browser-originated same-site requests may create users (blocks naive cross-site scripts).
// Agent: ALLOWS Sec-Fetch same-origin/same-site OR matching Origin/Referer; RETURNS Forbidden otherwise.
pub fn require_browser_user_creation(headers: &HeaderMap) -> Result<(), AppError> {
    let site = headers
        .get(SEC_FETCH_SITE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if site == "same-origin" || site == "same-site" {
        return Ok(());
    }

    if origin_matches_request_site(headers) {
        return Ok(());
    }

    Err(AppError::Forbidden(
        "user accounts can only be created from the web application".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn allows_same_origin_and_same_site() {
        for site in ["same-origin", "same-site", "SAME-ORIGIN"] {
            let mut headers = HeaderMap::new();
            headers.insert(SEC_FETCH_SITE, site.parse().unwrap());
            require_browser_user_creation(&headers).expect(site);
        }
    }

    #[test]
    fn allows_matching_origin_when_sec_fetch_missing() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "139.162.179.66:8080".parse().unwrap());
        headers.insert(
            "origin",
            "http://139.162.179.66:8080".parse().unwrap(),
        );
        require_browser_user_creation(&headers).expect("origin match");
    }

    #[test]
    fn allows_matching_origin_with_forwarded_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("x-forwarded-host", "ownly.example.com".parse().unwrap());
        headers.insert("origin", "https://ownly.example.com".parse().unwrap());
        require_browser_user_creation(&headers).expect("forwarded origin match");
    }

    #[test]
    fn rejects_missing_or_cross_site() {
        assert!(require_browser_user_creation(&HeaderMap::new()).is_err());
        let mut headers = HeaderMap::new();
        headers.insert(SEC_FETCH_SITE, "cross-site".parse().unwrap());
        assert!(require_browser_user_creation(&headers).is_err());
    }

    #[test]
    fn rejects_cross_site_origin_even_without_sec_fetch() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "ownly.example.com".parse().unwrap());
        headers.insert("origin", "https://evil.example".parse().unwrap());
        assert!(require_browser_user_creation(&headers).is_err());
    }

    #[test]
    fn allows_origin_when_default_http_port_omitted() {
        let mut headers = HeaderMap::new();
        headers.insert("host", "ownly.example.com:80".parse().unwrap());
        headers.insert("origin", "http://ownly.example.com".parse().unwrap());
        require_browser_user_creation(&headers).expect("default port match");
    }
}
