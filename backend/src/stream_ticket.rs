// Human: Short-lived HMAC tickets so byte-range streams can authorize without a JWT on every segment-sized request.
// Agent: READS signing_secret; EMITS `{file_id}.{user_id}.{expiry}.{hmac}`; validate_ticket USES constant-time HMAC compare.

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;

fn compute_hmac(payload: &str, secret: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts any key size");
    mac.update(payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Returns a signed ticket: `{file_id}.{user_id}.{expiry_unix}.{hmac_hex}`
pub fn generate_ticket(file_id: &str, user_id: &str, secret: &str, ttl_secs: u64) -> String {
    let expiry = chrono::Utc::now().timestamp() as u64 + ttl_secs;
    let payload = format!("{}.{}.{}", file_id, user_id, expiry);
    let sig = compute_hmac(&payload, secret);
    format!("{}.{}", payload, sig)
}

// Human: Verify ticket integrity and expiry; return embedded user id for access re-checks (SEC-018).
// Agent: RETURNS ticket user_id on success; REJECTS malformed, mismatched file_id, bad HMAC, or expired tickets.
pub fn validate_ticket(
    ticket: &str,
    expected_file_id: &str,
    secret: &str,
) -> Result<String, AppError> {
    let parts: Vec<&str> = ticket.split('.').collect();
    if parts.len() != 4 {
        return Err(reject_ticket(expected_file_id, "malformed_segment_count"));
    }

    let (file_id, user_id, expiry_str, provided_sig) = (parts[0], parts[1], parts[2], parts[3]);

    if file_id != expected_file_id {
        return Err(reject_ticket(expected_file_id, "file_id_mismatch"));
    }

    let payload = format!("{}.{}.{}", parts[0], parts[1], expiry_str);

    let provided_bytes = hex::decode(provided_sig)
        .map_err(|_| reject_ticket(expected_file_id, "invalid_hmac_encoding"))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| reject_ticket(expected_file_id, "hmac_init_failed"))?;
    mac.update(payload.as_bytes());
    if mac.verify_slice(&provided_bytes).is_err() {
        return Err(reject_ticket(expected_file_id, "hmac_mismatch"));
    }

    let expiry: i64 = expiry_str
        .parse()
        .map_err(|_| reject_ticket(expected_file_id, "invalid_expiry"))?;
    if chrono::Utc::now().timestamp() > expiry {
        return Err(reject_ticket(expected_file_id, "expired"));
    }

    Ok(user_id.to_string())
}

fn reject_ticket(expected_file_id: &str, reason: &'static str) -> AppError {
    tracing::debug!(
        reason,
        expected_file_id = %expected_file_id,
        "stream ticket rejected"
    );
    AppError::Unauthorized
}
