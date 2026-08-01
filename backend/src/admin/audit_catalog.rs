// Human: Single source of truth for audit action severity and human labels.
// Agent: Category = action namespace (text before first dot); unknown actions fall back to Info + derived label.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum AuditSeverity {
    /// Human: Irreversible data loss or privilege change.
    Critical,
    /// Human: Reversible destructive or access-reducing action.
    Warning,
    /// Human: State-changing mutation.
    Notice,
    /// Human: Read, export, or routine lifecycle event.
    Info,
}

impl AuditSeverity {
    pub const ALL: [AuditSeverity; 4] = [
        AuditSeverity::Critical,
        AuditSeverity::Warning,
        AuditSeverity::Notice,
        AuditSeverity::Info,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AuditSeverity::Critical => "Critical",
            AuditSeverity::Warning => "Warning",
            AuditSeverity::Notice => "Notice",
            AuditSeverity::Info => "Info",
        }
    }

    // Human: Parse a severity filter value from the query string, case-insensitively.
    // Agent: RETURNS None for unrecognized input so callers can reject the whole request.
    pub fn parse(raw: &str) -> Option<AuditSeverity> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "critical" => Some(AuditSeverity::Critical),
            "warning" => Some(AuditSeverity::Warning),
            "notice" => Some(AuditSeverity::Notice),
            "info" => Some(AuditSeverity::Info),
            _ => None,
        }
    }
}

/// Human: Severity and human-readable label for one audit action.
pub struct AuditActionMeta {
    pub severity: AuditSeverity,
    pub label: &'static str,
}

// Human: Every audit action written anywhere in the backend, with its severity and label.
// Agent: Keep sorted by action; unknown actions are handled by fallback, so omissions degrade rather than break.
const CATALOG: &[(&str, AuditSeverity, &str)] = &[
    // --- admin ---
    (
        "admin.gif_preview_temp.cleanup",
        AuditSeverity::Warning,
        "Administrator purged iOS GIF preview scratch files and cached MP4 sidecars",
    ),
    (
        "admin.logging.update",
        AuditSeverity::Notice,
        "Administrator updated logging configuration",
    ),
    (
        "admin.sessions.revoke",
        AuditSeverity::Warning,
        "Administrator revoked a user session",
    ),
    (
        "admin.sessions.revoke_others",
        AuditSeverity::Warning,
        "Administrator revoked other user sessions",
    ),
    (
        "admin.settings.update",
        AuditSeverity::Notice,
        "Administrator updated system settings",
    ),
    (
        "admin.storage_blobs.migrate",
        AuditSeverity::Critical,
        "Administrator migrated storage blobs between nodes",
    ),
    (
        "admin.storage_blobs.migrate_cancel",
        AuditSeverity::Warning,
        "Administrator cancelled a storage blob migration",
    ),
    (
        "admin.storage_blobs.migrate_start",
        AuditSeverity::Critical,
        "Administrator started a storage blob migration",
    ),
    (
        "admin.storage_blobs.preview",
        AuditSeverity::Info,
        "Administrator previewed a storage blob migration plan",
    ),
    (
        "admin.users.create",
        AuditSeverity::Notice,
        "Administrator created a user account",
    ),
    (
        "admin.users.delete",
        AuditSeverity::Critical,
        "Administrator removed a user account",
    ),
    (
        "admin.users.update",
        AuditSeverity::Notice,
        "Administrator updated a user account",
    ),
    // --- auth ---
    ("auth.login", AuditSeverity::Notice, "User signed in"),
    ("auth.logout", AuditSeverity::Info, "User signed out"),
    (
        "auth.password_change",
        AuditSeverity::Warning,
        "User changed their password",
    ),
    (
        "auth.register",
        AuditSeverity::Notice,
        "New account registered",
    ),
    (
        "auth.sessions.revoke",
        AuditSeverity::Warning,
        "User revoked a signed-in session",
    ),
    (
        "auth.sessions.revoke_others",
        AuditSeverity::Warning,
        "User revoked other signed-in sessions",
    ),
    // --- files ---
    (
        "files.content_replace",
        AuditSeverity::Warning,
        "File contents replaced",
    ),
    ("files.copy", AuditSeverity::Notice, "File copied"),
    (
        "files.delete.permanent",
        AuditSeverity::Critical,
        "File permanently deleted",
    ),
    (
        "files.download.bulk.complete",
        AuditSeverity::Info,
        "Bulk file download completed",
    ),
    (
        "files.download.bulk.start",
        AuditSeverity::Info,
        "Bulk file download started",
    ),
    (
        "files.export.start",
        AuditSeverity::Info,
        "File export started",
    ),
    (
        "files.hls.cleanup_orphan",
        AuditSeverity::Warning,
        "Orphaned HLS stream data cleaned up",
    ),
    (
        "files.hls.reprocess",
        AuditSeverity::Notice,
        "HLS stream reprocessing requested",
    ),
    (
        "files.hls.reprocess_cancel",
        AuditSeverity::Info,
        "HLS stream reprocessing cancelled",
    ),
    (
        "files.hls.reprocess_cancel_all",
        AuditSeverity::Warning,
        "All HLS stream reprocessing cancelled",
    ),
    (
        "files.ingest.cancel",
        AuditSeverity::Info,
        "File ingest cancelled",
    ),
    ("files.move", AuditSeverity::Notice, "File moved"),
    ("files.rename", AuditSeverity::Notice, "File renamed"),
    (
        "files.restore",
        AuditSeverity::Notice,
        "File restored from the recycle bin",
    ),
    (
        "files.thumbnail.regenerate",
        AuditSeverity::Info,
        "File thumbnail regenerated",
    ),
    (
        "files.thumbnail.select",
        AuditSeverity::Info,
        "File thumbnail frame selected",
    ),
    (
        "files.trash",
        AuditSeverity::Warning,
        "File moved to the recycle bin",
    ),
    (
        "files.upload",
        AuditSeverity::Notice,
        "File uploaded to storage",
    ),
    // --- folders ---
    ("folders.create", AuditSeverity::Notice, "Folder created"),
    (
        "folders.delete.permanent",
        AuditSeverity::Critical,
        "Folder permanently deleted",
    ),
    (
        "folders.download.complete",
        AuditSeverity::Info,
        "Folder download completed",
    ),
    (
        "folders.download.start",
        AuditSeverity::Info,
        "Folder download started",
    ),
    ("folders.move", AuditSeverity::Notice, "Folder moved"),
    ("folders.rename", AuditSeverity::Notice, "Folder renamed"),
    (
        "folders.restore",
        AuditSeverity::Notice,
        "Folder restored from the recycle bin",
    ),
    (
        "folders.trash",
        AuditSeverity::Warning,
        "Folder moved to the recycle bin",
    ),
    // --- groups ---
    ("groups.create", AuditSeverity::Notice, "Group created"),
    ("groups.delete", AuditSeverity::Warning, "Group deleted"),
    (
        "groups.member.add",
        AuditSeverity::Notice,
        "Member added to a group",
    ),
    (
        "groups.member.remove",
        AuditSeverity::Warning,
        "Member removed from a group",
    ),
    ("groups.update", AuditSeverity::Notice, "Group updated"),
    // --- permissions ---
    (
        "permissions.revoke",
        AuditSeverity::Critical,
        "Permission grant revoked",
    ),
    // --- recycle_bin ---
    (
        "recycle_bin.empty",
        AuditSeverity::Critical,
        "Recycle bin emptied — items permanently destroyed",
    ),
    (
        "recycle_bin.expired",
        AuditSeverity::Warning,
        "Recycle bin items expired and were purged",
    ),
    // --- setup ---
    (
        "setup.complete",
        AuditSeverity::Notice,
        "Instance setup completed",
    ),
    // --- shares ---
    ("shares.create", AuditSeverity::Notice, "Share created"),
    ("shares.leave", AuditSeverity::Notice, "User left a share"),
    (
        "shares.public_content_replace",
        AuditSeverity::Warning,
        "Public share contents replaced",
    ),
    ("shares.revoke", AuditSeverity::Warning, "Share revoked"),
    (
        "shares.save_from_public",
        AuditSeverity::Notice,
        "Item saved from a public share",
    ),
    ("shares.update", AuditSeverity::Notice, "Share updated"),
    (
        "shares.user_invite",
        AuditSeverity::Notice,
        "User invited to a share",
    ),
    (
        "shares.user_revoke",
        AuditSeverity::Warning,
        "User access to a share revoked",
    ),
    // --- spreadsheet ---
    (
        "spreadsheet.copilot",
        AuditSeverity::Info,
        "Spreadsheet copilot request",
    ),
    // --- storage_nodes ---
    (
        "storage_nodes.create",
        AuditSeverity::Notice,
        "Storage node added",
    ),
    (
        "storage_nodes.update",
        AuditSeverity::Warning,
        "Storage node configuration changed",
    ),
    // --- uploads ---
    (
        "uploads.session.abort",
        AuditSeverity::Info,
        "Upload session aborted",
    ),
    (
        "uploads.session.create",
        AuditSeverity::Info,
        "Upload session started",
    ),
    (
        "uploads.session.expire",
        AuditSeverity::Info,
        "Upload session expired",
    ),
];

// Human: Category for an action — the namespace before the first dot, matching the generated SQL column.
// Agent: MUST stay identical to split_part(action, '.', 1) in migration 037.
pub fn category_of(action: &str) -> &str {
    match action.find('.') {
        Some(idx) => &action[..idx],
        None => action,
    }
}

fn lookup(action: &str) -> Option<&'static (&'static str, AuditSeverity, &'static str)> {
    CATALOG.iter().find(|(name, _, _)| *name == action)
}

// Human: Severity for an action; unknown actions are Info so they stay visible but unalarming.
// Agent: USED by row mapping and by severity->actions filter expansion.
pub fn severity_of(action: &str) -> AuditSeverity {
    lookup(action)
        .map(|(_, severity, _)| *severity)
        .unwrap_or(AuditSeverity::Info)
}

// Human: Human-readable sentence for an action, falling back to the raw action plus resource metadata.
// Agent: Fallback keeps newly added actions legible before anyone updates the catalog.
pub fn label_of(action: &str, resource_type: Option<&str>, resource_id: Option<&str>) -> String {
    if let Some((_, _, label)) = lookup(action) {
        return (*label).to_string();
    }

    let target = match (resource_type, resource_id) {
        (Some(rt), Some(rid)) => format!(" ({rt}: {rid})"),
        (Some(rt), None) => format!(" ({rt})"),
        _ => String::new(),
    };
    format!("{action}{target}")
}

// Human: Every catalogued action carrying the given severity — expands a severity filter into an IN list.
// Agent: Lets severity filtering use the action index instead of a computed predicate.
pub fn actions_with_severity(severities: &[AuditSeverity]) -> Vec<String> {
    CATALOG
        .iter()
        .filter(|(_, severity, _)| severities.contains(severity))
        .map(|(action, _, _)| (*action).to_string())
        .collect()
}

// Human: True when Info is among the requested severities — Info is also the unknown-action fallback.
// Agent: Callers must then match uncatalogued actions too, not just the Info IN list.
pub fn severity_filter_includes_unknown(severities: &[AuditSeverity]) -> bool {
    severities.contains(&AuditSeverity::Info)
}

// Human: All catalogued action names — powers the action picker's option list.
pub fn all_actions() -> Vec<&'static str> {
    CATALOG.iter().map(|(action, _, _)| *action).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // Human: Contract test — a duplicated action would make lookup order decide severity silently.
    // Agent: ASSERTS catalog keys are unique.
    #[test]
    fn catalog_has_no_duplicate_actions() {
        let mut seen = HashSet::new();
        for (action, _, _) in CATALOG {
            assert!(seen.insert(*action), "duplicate catalog entry: {action}");
        }
    }

    // Human: Category must match the SQL generated column or filters and counts diverge.
    // Agent: ASSERTS category_of mirrors split_part(action, '.', 1) including the no-dot case.
    #[test]
    fn category_is_the_action_namespace() {
        assert_eq!(category_of("files.delete.permanent"), "files");
        assert_eq!(category_of("auth.login"), "auth");
        assert_eq!(category_of("setup"), "setup");
        assert_eq!(category_of(""), "");
    }

    // Human: Every catalogued action must land in a namespace, never an empty category.
    #[test]
    fn every_catalog_action_has_a_category() {
        for (action, _, _) in CATALOG {
            assert!(
                !category_of(action).is_empty(),
                "action {action} produced an empty category"
            );
        }
    }

    // Human: Unknown actions must stay visible rather than vanishing from every filter.
    // Agent: ASSERTS Info severity and a label that still identifies the event.
    #[test]
    fn unknown_action_falls_back_without_losing_information() {
        assert_eq!(severity_of("brand.new.action"), AuditSeverity::Info);
        assert_eq!(
            label_of("brand.new.action", Some("file"), Some("f-1")),
            "brand.new.action (file: f-1)"
        );
        assert_eq!(label_of("weird", None, None), "weird");
        assert_eq!(
            label_of("weird", Some("folder"), None),
            "weird (folder)"
        );
    }

    // Human: Catalogued actions must use the curated label, not the raw fallback.
    #[test]
    fn known_action_uses_catalog_label() {
        assert_eq!(
            label_of("admin.users.delete", Some("user"), Some("u-1")),
            "Administrator removed a user account"
        );
        assert_eq!(severity_of("admin.users.delete"), AuditSeverity::Critical);
    }

    // Human: Severity filtering expands to an action list — an empty expansion would silently match nothing.
    #[test]
    fn severity_expansion_returns_matching_actions() {
        let critical = actions_with_severity(&[AuditSeverity::Critical]);
        assert!(critical.contains(&"files.delete.permanent".to_string()));
        assert!(critical.contains(&"recycle_bin.empty".to_string()));
        assert!(!critical.contains(&"auth.login".to_string()));

        for severity in AuditSeverity::ALL {
            assert!(
                !actions_with_severity(&[severity]).is_empty(),
                "{severity:?} has no catalogued actions"
            );
        }
    }

    // Human: Info filters must also admit uncatalogued actions, which default to Info.
    #[test]
    fn info_severity_filter_admits_unknown_actions() {
        assert!(severity_filter_includes_unknown(&[AuditSeverity::Info]));
        assert!(!severity_filter_includes_unknown(&[
            AuditSeverity::Critical,
            AuditSeverity::Warning
        ]));
    }

    // Human: Query-string severity values arrive as free text and must round-trip.
    #[test]
    fn severity_parses_case_insensitively() {
        assert_eq!(AuditSeverity::parse("critical"), Some(AuditSeverity::Critical));
        assert_eq!(AuditSeverity::parse(" Warning "), Some(AuditSeverity::Warning));
        assert_eq!(AuditSeverity::parse("NOTICE"), Some(AuditSeverity::Notice));
        assert_eq!(AuditSeverity::parse("nonsense"), None);
    }
}
