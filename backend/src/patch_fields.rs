// Human: Tri-state PATCH field deserialization — distinguish JSON omit vs null vs string value.
// Agent: USED by PatchFolderRequest.parent_id and PatchFileRequest.folder_id; FIXES root-move 400s.

use serde::{Deserialize, Deserializer};

// Human: Deserialize a PATCH field that may be absent (unchanged), null (clear/root), or a string id.
// Agent: CALLED via #[serde(default, deserialize_with = ...)]; RETURNS None | Some(None) | Some(Some(s)).
pub fn deserialize_optional_nullable_string<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(Some(None)),
        serde_json::Value::String(string) => Ok(Some(Some(string))),
        _ => Err(serde::de::Error::custom(
            "expected string or null for nullable patch field",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::deserialize_optional_nullable_string;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct SamplePatch {
        #[serde(default)]
        #[serde(deserialize_with = "deserialize_optional_nullable_string")]
        parent_id: Option<Option<String>>,
    }

    #[test]
    fn null_deserializes_as_some_none() {
        let body: SamplePatch =
            serde_json::from_str(r#"{"parent_id": null}"#).expect("parse null parent_id");
        assert_eq!(body.parent_id, Some(None));
    }

    #[test]
    fn string_deserializes_as_some_some() {
        let body: SamplePatch =
            serde_json::from_str(r#"{"parent_id": "abc-123"}"#).expect("parse string parent_id");
        assert_eq!(body.parent_id, Some(Some("abc-123".into())));
    }

    #[test]
    fn absent_field_deserializes_as_none() {
        let body: SamplePatch = serde_json::from_str(r#"{}"#).expect("parse empty body");
        assert!(body.parent_id.is_none());
    }
}
