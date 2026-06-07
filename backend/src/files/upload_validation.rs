// Human: Validate and normalize client-supplied upload filenames before DB or storage use.
// Agent: STRIPS path segments; REJECTS traversal/control chars; ALLOWS .html and other document types.

use std::fmt;

use serde::de::{self, Deserializer, Visitor};

use crate::error::AppError;

/// Human: Maximum stored display name length for uploaded files.
/// Agent: MATCHES folders::normalize_folder_name cap; REJECTS longer client names.
pub const MAX_UPLOAD_FILENAME_LEN: usize = 255;

/// Human: SHA-256 digests are stored and compared as 64 lowercase hex characters.
/// Agent: MATCHES content_hash::hash_file_sha256 output and browser preflight hashing.
pub const CONTENT_HASH_HEX_LEN: usize = 64;

/// Human: Accept JSON numbers or numeric strings for upload byte sizes from browser clients.
/// Agent: DESERIALIZES u64/i64/f64/string; REJECTS negative, fractional, or missing values at handler layer.
pub fn deserialize_upload_size_bytes<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    struct SizeVisitor;

    impl Visitor<'_> for SizeVisitor {
        type Value = i64;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a non-negative integer size in bytes")
        }

        fn visit_i64<E>(self, value: i64) -> Result<i64, E>
        where
            E: de::Error,
        {
            if value < 0 {
                return Err(E::custom("size_bytes must be non-negative"));
            }
            Ok(value)
        }

        fn visit_u64<E>(self, value: u64) -> Result<i64, E>
        where
            E: de::Error,
        {
            i64::try_from(value).map_err(|_| E::custom("size_bytes is too large"))
        }

        fn visit_f64<E>(self, value: f64) -> Result<i64, E>
        where
            E: de::Error,
        {
            if !value.is_finite() || value.fract() != 0.0 || value < 0.0 {
                return Err(E::custom("size_bytes must be a non-negative integer"));
            }
            Ok(value as i64)
        }

        fn visit_str<E>(self, value: &str) -> Result<i64, E>
        where
            E: de::Error,
        {
            let parsed: u64 = value
                .trim()
                .parse()
                .map_err(|_| E::custom("size_bytes must be a non-negative integer"))?;
            i64::try_from(parsed).map_err(|_| E::custom("size_bytes is too large"))
        }
    }

    deserializer.deserialize_any(SizeVisitor)
}

// Human: Normalize a browser-provided filename to a safe display basename.
// Agent: TRIMS; TAKES final path segment; REJECTS separators, dot names, control chars, and overlong names.
pub fn normalize_upload_filename(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation(
            "filename is required",
            serde_json::json!({ "name": "required" }),
        ));
    }

    let basename = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|segment| segment.to_str())
        .unwrap_or(trimmed);

    if basename.is_empty() || basename == "." || basename == ".." {
        return Err(AppError::validation(
            "filename is invalid",
            serde_json::json!({ "name": "invalid" }),
        ));
    }

    if basename.len() > MAX_UPLOAD_FILENAME_LEN {
        return Err(AppError::validation(
            "filename is too long",
            serde_json::json!({ "name": "too_long" }),
        ));
    }

    if basename.contains('/') || basename.contains('\\') {
        return Err(AppError::validation(
            "filename cannot contain path separators",
            serde_json::json!({ "name": "path_separator" }),
        ));
    }

    if basename.bytes().any(|byte| byte == 0 || byte < 32) {
        return Err(AppError::validation(
            "filename contains invalid characters",
            serde_json::json!({ "name": "invalid_characters" }),
        ));
    }

    Ok(basename.to_string())
}

// Human: Normalize a client-supplied SHA-256 content hash for duplicate preflight checks.
// Agent: TRIMS; LOWERCASES; REJECTS non-hex or wrong-length values.
pub fn normalize_content_hash(content_hash: &str) -> Result<String, AppError> {
    let normalized = content_hash.trim().to_ascii_lowercase();
    if normalized.len() != CONTENT_HASH_HEX_LEN {
        return Err(AppError::validation(
            "content_hash must be a 64-character SHA-256 hex digest",
            serde_json::json!({ "content_hash": "invalid_length" }),
        ));
    }

    if !normalized
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::validation(
            "content_hash must be a hexadecimal SHA-256 digest",
            serde_json::json!({ "content_hash": "invalid_characters" }),
        ));
    }

    Ok(normalized)
}

// Human: Validate a declared upload size after JSON parsing.
// Agent: REJECTS negative values; CASTS to u64 for recycle-bin exact matching.
pub fn normalize_upload_size_bytes(size_bytes: i64) -> Result<u64, AppError> {
    if size_bytes < 0 {
        return Err(AppError::validation(
            "size_bytes must be non-negative",
            serde_json::json!({ "size_bytes": "invalid" }),
        ));
    }
    Ok(size_bytes as u64)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_content_hash, normalize_upload_filename, normalize_upload_size_bytes,
    };

    // Human: REGRESSION — HTML documents must pass filename normalization.
    // Agent: ASSERTS .html basename is preserved without extension blocking.
    #[test]
    fn normalize_upload_filename_allows_html_documents() {
        let name = normalize_upload_filename("notes/report.html").expect("html filename");
        assert_eq!(name, "report.html");
    }

    // Human: REGRESSION — client-supplied paths must not become stored names.
    // Agent: ASSERTS only the final segment is kept.
    #[test]
    fn normalize_upload_filename_strips_path_segments() {
        let name =
            normalize_upload_filename("C:\\Users\\secret\\page.html").expect("windows-style path");
        assert_eq!(name, "page.html");
    }

    #[test]
    fn normalize_upload_filename_rejects_dot_names() {
        assert!(normalize_upload_filename(".").is_err());
        assert!(normalize_upload_filename("..").is_err());
    }

    #[test]
    fn normalize_upload_size_bytes_rejects_negative_values() {
        assert!(normalize_upload_size_bytes(-1).is_err());
        assert_eq!(normalize_upload_size_bytes(0).expect("zero"), 0);
    }

    #[test]
    fn normalize_content_hash_accepts_lowercase_sha256() {
        let digest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let normalized = normalize_content_hash(digest).expect("empty sha256");
        assert_eq!(normalized, digest);
    }

    #[test]
    fn normalize_content_hash_rejects_invalid_values() {
        assert!(normalize_content_hash("not-a-hash").is_err());
        assert!(normalize_content_hash("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz").is_err());
    }
}
