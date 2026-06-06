// Human: Reject non-browser API clients on register and admin user creation (not POST /setup).
// Agent: READS Sec-Fetch-Site; CALLED from register and admin create_user; setup uses X-Setup-Token only.

use axum::http::HeaderMap;

use crate::error::AppError;

/// Human: Fetch Metadata header browsers send on SPA requests; absent on curl/scripts.
/// Agent: MATCHED in require_browser_user_creation; integration tests set same-origin.
pub const SEC_FETCH_SITE: &str = "Sec-Fetch-Site";

// Human: Only same-origin/same-site fetches from the web app may create users (not audit scripts).
// Agent: RETURNS Forbidden when header missing or cross-site; ALLOWS same-origin and same-site.
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
    fn rejects_missing_or_cross_site() {
        assert!(require_browser_user_creation(&HeaderMap::new()).is_err());
        let mut headers = HeaderMap::new();
        headers.insert(SEC_FETCH_SITE, "cross-site".parse().unwrap());
        assert!(require_browser_user_creation(&headers).is_err());
    }
}
