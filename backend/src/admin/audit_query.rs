// Human: Filter model and SQL composition for the admin audit ledger.
// Agent: BUILDS parameterized WHERE via sqlx QueryBuilder; NEVER interpolates user input; keyset pagination on (created_at, id).

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{Postgres, QueryBuilder};

use crate::admin::audit_catalog::{self, AuditSeverity};

/// Human: Rows joined with the actor so free-text search can match on email.
pub const SELECT_ROW_COLUMNS: &str = "SELECT a.id, a.created_at, a.user_id AS actor_id, \
     u.email AS actor_email, a.action, a.resource_type, a.resource_id, a.ip, a.user_agent, a.context \
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id";

/// Human: One audit row exactly as stored, before catalog enrichment.
#[derive(Debug, sqlx::FromRow)]
pub struct AuditRowRaw {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub actor_id: Option<String>,
    pub actor_email: Option<String>,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub context: Option<serde_json::Value>,
}

/// Human: Sort direction for the timestamp column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditSort {
    Newest,
    Oldest,
}

impl AuditSort {
    pub fn parse(raw: Option<&str>) -> AuditSort {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("oldest") | Some("asc") => AuditSort::Oldest,
            _ => AuditSort::Newest,
        }
    }

    fn order_clause(self) -> &'static str {
        match self {
            AuditSort::Newest => " ORDER BY a.created_at DESC, a.id DESC",
            AuditSort::Oldest => " ORDER BY a.created_at ASC, a.id ASC",
        }
    }

    fn keyset_operator(self) -> &'static str {
        match self {
            AuditSort::Newest => " < ",
            AuditSort::Oldest => " > ",
        }
    }
}

/// Human: Opaque page cursor — the (timestamp, id) of the last row already delivered.
#[derive(Debug, Clone)]
pub struct AuditCursor {
    pub created_at: DateTime<Utc>,
    pub id: String,
}

impl AuditCursor {
    // Human: Encode as "<rfc3339>|<id>" — readable in a URL and trivially reversible.
    pub fn encode(&self) -> String {
        format!("{}|{}", self.created_at.to_rfc3339(), self.id)
    }

    // Human: Parse a cursor from the query string; malformed cursors are ignored, not fatal.
    // Agent: RETURNS None so a stale/garbled cursor restarts from page one instead of erroring.
    pub fn parse(raw: &str) -> Option<AuditCursor> {
        let (ts, id) = raw.split_once('|')?;
        let created_at = DateTime::parse_from_rfc3339(ts).ok()?.with_timezone(&Utc);
        if id.is_empty() {
            return None;
        }
        Some(AuditCursor {
            created_at,
            id: id.to_string(),
        })
    }
}

/// Human: Which filter dimension a facet query is counting, so it can exclude itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FacetDimension {
    None,
    Category,
    Action,
    Severity,
    Actor,
}

/// Human: Every audit filter dimension the admin panel exposes.
/// Agent: Empty vectors and None fields mean "no constraint" — never an empty IN list.
#[derive(Debug, Default, Clone, Deserialize)]
pub struct AuditFilter {
    pub q: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub categories: Vec<String>,
    pub actions: Vec<String>,
    #[serde(skip)]
    pub severities: Vec<AuditSeverity>,
    pub actor_ids: Vec<String>,
    pub ip: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
}

// Human: Neutralize LIKE metacharacters so searching for "100%" is a literal, not a wildcard.
// Agent: Pairs with ESCAPE '\' on every ILIKE below.
fn escape_like(raw: &str) -> String {
    raw.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

impl AuditFilter {
    // Human: Append the WHERE clause for this filter, optionally ignoring one dimension for facet counts.
    // Agent: MUTATES builder; every value goes through push_bind — no interpolation.
    pub fn push_where(&self, builder: &mut QueryBuilder<'_, Postgres>, exclude: FacetDimension) {
        let mut first = true;
        let mut open = |builder: &mut QueryBuilder<'_, Postgres>| {
            if first {
                builder.push(" WHERE ");
                first = false;
            } else {
                builder.push(" AND ");
            }
        };

        if let Some(q) = self.q.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            let pattern = format!("%{}%", escape_like(q));
            open(builder);
            builder.push("(a.action ILIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" ESCAPE '\\' OR a.resource_id ILIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" ESCAPE '\\' OR a.ip ILIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" ESCAPE '\\' OR u.email ILIKE ");
            builder.push_bind(pattern);
            builder.push(" ESCAPE '\\')");
        }

        if let Some(from) = self.from {
            open(builder);
            builder.push("a.created_at >= ");
            builder.push_bind(from);
        }

        if let Some(to) = self.to {
            open(builder);
            builder.push("a.created_at <= ");
            builder.push_bind(to);
        }

        if !self.categories.is_empty() && exclude != FacetDimension::Category {
            open(builder);
            builder.push("a.action_namespace = ANY(");
            builder.push_bind(self.categories.clone());
            builder.push(")");
        }

        if !self.actions.is_empty() && exclude != FacetDimension::Action {
            open(builder);
            builder.push("a.action = ANY(");
            builder.push_bind(self.actions.clone());
            builder.push(")");
        }

        if !self.severities.is_empty() && exclude != FacetDimension::Severity {
            // Human: Severity is a catalog property, so it expands into an indexed action list.
            // Agent: Info also covers uncatalogued actions — hence the NOT-IN-catalog arm.
            let matching = audit_catalog::actions_with_severity(&self.severities);
            open(builder);
            builder.push("(a.action = ANY(");
            builder.push_bind(matching);
            builder.push(")");
            if audit_catalog::severity_filter_includes_unknown(&self.severities) {
                let known: Vec<String> = audit_catalog::all_actions()
                    .into_iter()
                    .map(str::to_string)
                    .collect();
                builder.push(" OR NOT (a.action = ANY(");
                builder.push_bind(known);
                builder.push("))");
            }
            builder.push(")");
        }

        if !self.actor_ids.is_empty() && exclude != FacetDimension::Actor {
            // Human: The literal "system" selects rows with no authenticated actor.
            let wants_system = self.actor_ids.iter().any(|id| id == "system");
            let real_ids: Vec<String> = self
                .actor_ids
                .iter()
                .filter(|id| id.as_str() != "system")
                .cloned()
                .collect();
            open(builder);
            builder.push("(");
            if !real_ids.is_empty() {
                builder.push("a.user_id = ANY(");
                builder.push_bind(real_ids);
                builder.push(")");
                if wants_system {
                    builder.push(" OR a.user_id IS NULL");
                }
            } else {
                builder.push("a.user_id IS NULL");
            }
            builder.push(")");
        }

        if let Some(ip) = self.ip.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            open(builder);
            builder.push("a.ip = ");
            builder.push_bind(ip.to_string());
        }

        if let Some(rt) = self
            .resource_type
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            open(builder);
            builder.push("a.resource_type = ");
            builder.push_bind(rt.to_string());
        }

        if let Some(rid) = self
            .resource_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            open(builder);
            builder.push("a.resource_id = ");
            builder.push_bind(rid.to_string());
        }
    }

    // Human: Full row query for one page, one row over-fetched to detect a further page.
    // Agent: RETURNS builder ready to build_query_as::<AuditRowRaw>().
    pub fn rows_query(
        &self,
        sort: AuditSort,
        cursor: Option<&AuditCursor>,
        limit: i64,
    ) -> QueryBuilder<'_, Postgres> {
        let mut builder = QueryBuilder::new(SELECT_ROW_COLUMNS);
        self.push_where(&mut builder, FacetDimension::None);
        self.push_keyset(&mut builder, sort, cursor);
        builder.push(sort.order_clause());
        builder.push(" LIMIT ");
        builder.push_bind(limit + 1);
        builder
    }

    // Human: Keyset predicate — row comparison keeps paging stable as new events arrive.
    // Agent: OFFSET would shift rows mid-browse on an append-only ledger.
    fn push_keyset(
        &self,
        builder: &mut QueryBuilder<'_, Postgres>,
        sort: AuditSort,
        cursor: Option<&AuditCursor>,
    ) {
        let Some(cursor) = cursor else { return };
        // Human: push_where always emits WHERE first when any filter is set; detect that from the SQL built so far.
        let needs_where = !builder.sql().contains(" WHERE ");
        builder.push(if needs_where { " WHERE (" } else { " AND (" });
        builder.push("a.created_at, a.id)");
        builder.push(sort.keyset_operator());
        builder.push("(");
        builder.push_bind(cursor.created_at);
        builder.push(", ");
        builder.push_bind(cursor.id.clone());
        builder.push(")");
    }

    // Human: COUNT(*) over the same filter, for the "N matching events" readout.
    pub fn count_query(&self) -> QueryBuilder<'_, Postgres> {
        let mut builder = QueryBuilder::new(
            "SELECT COUNT(*)::BIGINT FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id",
        );
        self.push_where(&mut builder, FacetDimension::None);
        builder
    }

    // Human: Grouped aggregate for one facet dimension, excluding that dimension's own constraint.
    // Agent: group_expr is a fixed SQL fragment chosen by the caller — never user input.
    pub fn facet_query(
        &self,
        group_expr: &str,
        exclude: FacetDimension,
        limit: Option<i64>,
    ) -> QueryBuilder<'_, Postgres> {
        let mut builder = QueryBuilder::new("SELECT ");
        builder.push(group_expr);
        builder.push(" AS facet_key, COUNT(*)::BIGINT AS facet_count \
             FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id");
        self.push_where(&mut builder, exclude);
        builder.push(" GROUP BY 1 ORDER BY facet_count DESC, facet_key ASC");
        if let Some(limit) = limit {
            builder.push(" LIMIT ");
            builder.push_bind(limit);
        }
        builder
    }

    // Human: Summary aggregates for the metric cards — one pass over the filtered set.
    // Agent: elevated = Critical + Warning, expanded through the catalog into an indexed IN list.
    pub fn summary_query(&self) -> QueryBuilder<'_, Postgres> {
        let elevated =
            audit_catalog::actions_with_severity(&[AuditSeverity::Critical, AuditSeverity::Warning]);
        let mut builder = QueryBuilder::new("SELECT COUNT(*)::BIGINT AS total, ");
        builder.push("COUNT(DISTINCT a.user_id)::BIGINT AS distinct_actors, ");
        builder.push("COUNT(*) FILTER (WHERE a.action = ANY(");
        builder.push_bind(elevated);
        builder.push("))::BIGINT AS elevated \
             FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id");
        self.push_where(&mut builder, FacetDimension::None);
        builder
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sql_for(filter: &AuditFilter, exclude: FacetDimension) -> String {
        let mut builder = QueryBuilder::<Postgres>::new(SELECT_ROW_COLUMNS);
        filter.push_where(&mut builder, exclude);
        builder.sql().to_string()
    }

    // Human: An unfiltered request must not emit a WHERE clause at all.
    #[test]
    fn empty_filter_emits_no_where() {
        let sql = sql_for(&AuditFilter::default(), FacetDimension::None);
        assert!(!sql.contains("WHERE"), "unexpected WHERE in: {sql}");
    }

    // Human: The first condition opens with WHERE, later ones chain with AND.
    #[test]
    fn conditions_chain_with_and() {
        let filter = AuditFilter {
            categories: vec!["files".into()],
            ip: Some("10.0.0.1".into()),
            ..Default::default()
        };
        let sql = sql_for(&filter, FacetDimension::None);
        assert_eq!(sql.matches(" WHERE ").count(), 1);
        assert!(sql.contains(" AND "));
    }

    // Human: Facet counts must ignore their own dimension or every count collapses to the current selection.
    #[test]
    fn facet_dimension_is_excluded_from_its_own_query() {
        let filter = AuditFilter {
            categories: vec!["files".into()],
            ..Default::default()
        };
        assert!(sql_for(&filter, FacetDimension::None).contains("action_namespace"));
        assert!(!sql_for(&filter, FacetDimension::Category).contains("action_namespace"));
    }

    // Human: User input must never reach the SQL text — only placeholders.
    #[test]
    fn user_input_is_bound_not_interpolated() {
        let filter = AuditFilter {
            q: Some("'; DROP TABLE audit_logs; --".into()),
            ip: Some("1.2.3.4".into()),
            ..Default::default()
        };
        let sql = sql_for(&filter, FacetDimension::None);
        assert!(!sql.contains("DROP TABLE"));
        assert!(!sql.contains("1.2.3.4"));
        assert!(sql.contains("$1"));
    }

    // Human: LIKE metacharacters in a search term must match literally.
    #[test]
    fn like_wildcards_in_search_are_escaped() {
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("back\\slash"), "back\\\\slash");
    }

    // Human: Free-text search spans action, resource, ip, and actor email.
    #[test]
    fn search_covers_every_text_dimension() {
        let filter = AuditFilter {
            q: Some("alice".into()),
            ..Default::default()
        };
        let sql = sql_for(&filter, FacetDimension::None);
        for column in ["a.action ILIKE", "a.resource_id ILIKE", "a.ip ILIKE", "u.email ILIKE"] {
            assert!(sql.contains(column), "missing {column} in: {sql}");
        }
    }

    // Human: "system" selects unauthenticated rows, which are NULL rather than a user id.
    #[test]
    fn system_actor_matches_null_user_id() {
        let only_system = AuditFilter {
            actor_ids: vec!["system".into()],
            ..Default::default()
        };
        let sql = sql_for(&only_system, FacetDimension::None);
        assert!(sql.contains("a.user_id IS NULL"));
        assert!(!sql.contains("a.user_id = ANY"));

        let mixed = AuditFilter {
            actor_ids: vec!["system".into(), "u-1".into()],
            ..Default::default()
        };
        let sql = sql_for(&mixed, FacetDimension::None);
        assert!(sql.contains("a.user_id = ANY"));
        assert!(sql.contains("OR a.user_id IS NULL"));
    }

    // Human: Info must also admit uncatalogued actions, which default to Info severity.
    #[test]
    fn info_severity_filter_includes_uncatalogued_actions() {
        let info = AuditFilter {
            severities: vec![AuditSeverity::Info],
            ..Default::default()
        };
        assert!(sql_for(&info, FacetDimension::None).contains("NOT (a.action = ANY("));

        let critical = AuditFilter {
            severities: vec![AuditSeverity::Critical],
            ..Default::default()
        };
        assert!(!sql_for(&critical, FacetDimension::None).contains("NOT (a.action = ANY("));
    }

    // Human: Keyset pagination must compare the (created_at, id) tuple, not created_at alone.
    #[test]
    fn cursor_emits_row_comparison_in_sort_direction() {
        let cursor = AuditCursor {
            created_at: Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap(),
            id: "row-9".into(),
        };
        let newest = AuditFilter::default()
            .rows_query(AuditSort::Newest, Some(&cursor), 50)
            .sql()
            .to_string();
        assert!(newest.contains("a.created_at, a.id) < ("));
        assert!(newest.contains("ORDER BY a.created_at DESC, a.id DESC"));

        let oldest = AuditFilter::default()
            .rows_query(AuditSort::Oldest, Some(&cursor), 50)
            .sql()
            .to_string();
        assert!(oldest.contains("a.created_at, a.id) > ("));
        assert!(oldest.contains("ORDER BY a.created_at ASC, a.id ASC"));
    }

    // Human: A cursor combined with filters must chain onto the existing WHERE, not open a second one.
    #[test]
    fn cursor_chains_onto_existing_where() {
        let cursor = AuditCursor {
            created_at: Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap(),
            id: "row-9".into(),
        };
        let filter = AuditFilter {
            categories: vec!["auth".into()],
            ..Default::default()
        };
        let sql = filter
            .rows_query(AuditSort::Newest, Some(&cursor), 50)
            .sql()
            .to_string();
        assert_eq!(sql.matches(" WHERE ").count(), 1, "double WHERE in: {sql}");
    }

    // Human: Cursors round-trip through the query string; malformed ones restart from page one.
    #[test]
    fn cursor_round_trips_and_rejects_garbage() {
        let cursor = AuditCursor {
            created_at: Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap(),
            id: "row-9".into(),
        };
        let parsed = AuditCursor::parse(&cursor.encode()).expect("round-trip");
        assert_eq!(parsed.id, "row-9");
        assert_eq!(parsed.created_at, cursor.created_at);

        assert!(AuditCursor::parse("nonsense").is_none());
        assert!(AuditCursor::parse("2026-08-01T12:00:00Z|").is_none());
        assert!(AuditCursor::parse("not-a-date|row-9").is_none());
    }

    // Human: Over-fetch by one so the caller can report has_more without a second count.
    #[test]
    fn rows_query_over_fetches_by_one() {
        let sql = AuditFilter::default()
            .rows_query(AuditSort::Newest, None, 50)
            .sql()
            .to_string();
        assert!(sql.contains("LIMIT "));
    }

    // Human: Sort parsing defaults to newest-first for absent or unrecognized values.
    #[test]
    fn sort_defaults_to_newest() {
        assert_eq!(AuditSort::parse(None), AuditSort::Newest);
        assert_eq!(AuditSort::parse(Some("garbage")), AuditSort::Newest);
        assert_eq!(AuditSort::parse(Some("oldest")), AuditSort::Oldest);
        assert_eq!(AuditSort::parse(Some("ASC")), AuditSort::Oldest);
    }
}
