// Human: Admin audit ledger API — filtered rows, facet counts, and streaming CSV export.
// Agent: GET /api/v1/admin/audit-logs{,/facets,/export.csv}; REQUIRES InstanceAuditRead; AUDIT exempt (reads).

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::{
    admin::{
        audit_catalog::{self, AuditSeverity},
        audit_query::{AuditCursor, AuditFilter, AuditRowRaw, AuditSort, FacetDimension},
        console::read_setting,
        handlers::require_instance_permission,
    },
    auth::handlers::Claims,
    authz::Permission,
    error::AppError,
    AppState,
};

/// Human: app_settings key holding the per-export row ceiling.
pub const AUDIT_EXPORT_MAX_ROWS_KEY: &str = "audit_export_max_rows";
/// Human: Default export ceiling when the setting is unset or unparseable.
pub const AUDIT_EXPORT_MAX_ROWS_DEFAULT: i64 = 100_000;
/// Human: Rows pulled per round trip while streaming an export — bounds server memory.
const EXPORT_BATCH_ROWS: i64 = 1_000;
const DEFAULT_PAGE_ROWS: i64 = 50;
const MAX_PAGE_ROWS: i64 = 200;
const FACET_TOP_N: i64 = 10;

// Human: Effective export ceiling; 0 means unlimited.
// Agent: READS app_settings; a missing or corrupt value degrades to the default, never fails the export.
pub async fn export_max_rows(pool: &PgPool) -> i64 {
    read_setting(pool, AUDIT_EXPORT_MAX_ROWS_KEY)
        .await
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .unwrap_or(AUDIT_EXPORT_MAX_ROWS_DEFAULT)
}

/// Human: Raw query string for every audit endpoint — repeated keys arrive comma-separated.
#[derive(Debug, Default, Deserialize)]
pub struct AuditLogsQuery {
    pub q: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub categories: Option<String>,
    pub actions: Option<String>,
    pub severities: Option<String>,
    pub actors: Option<String>,
    pub ip: Option<String>,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub sort: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

// Human: Split a comma-separated filter value, dropping blanks so "a,,b" is two values.
fn split_csv(raw: Option<&String>) -> Vec<String> {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

// Human: Parse an RFC 3339 timestamp bound, rejecting malformed input rather than ignoring it.
// Agent: A silently dropped date bound would show the operator the wrong window.
fn parse_time_bound(raw: Option<&String>, field: &str) -> Result<Option<DateTime<Utc>>, AppError> {
    let Some(raw) = raw.map(|v| v.trim()).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| Some(dt.with_timezone(&Utc)))
        .map_err(|_| AppError::BadRequest(format!("{field} must be an RFC 3339 timestamp")))
}

impl AuditLogsQuery {
    // Human: Translate the query string into the typed filter, rejecting unusable values.
    // Agent: RETURNS BadRequest on bad severity/date so filters never silently no-op.
    fn to_filter(&self) -> Result<AuditFilter, AppError> {
        let mut severities = Vec::new();
        for raw in split_csv(self.severities.as_ref()) {
            match AuditSeverity::parse(&raw) {
                Some(severity) => severities.push(severity),
                None => {
                    return Err(AppError::BadRequest(format!("unknown severity: {raw}")));
                }
            }
        }

        let from = parse_time_bound(self.from.as_ref(), "from")?;
        let to = parse_time_bound(self.to.as_ref(), "to")?;
        if let (Some(from), Some(to)) = (from, to) {
            if from > to {
                return Err(AppError::BadRequest(
                    "from must not be later than to".into(),
                ));
            }
        }

        Ok(AuditFilter {
            q: self.q.clone(),
            from,
            to,
            categories: split_csv(self.categories.as_ref()),
            actions: split_csv(self.actions.as_ref()),
            severities,
            actor_ids: split_csv(self.actors.as_ref()),
            ip: self.ip.clone(),
            resource_type: self.resource_type.clone(),
            resource_id: self.resource_id.clone(),
        })
    }

    fn page_limit(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT_PAGE_ROWS).clamp(1, MAX_PAGE_ROWS)
    }
}

/// Human: One audit event with everything the detail drawer needs.
#[derive(Debug, Serialize)]
pub struct AdminAuditLogRow {
    pub id: String,
    /// Human: RFC 3339 UTC — the client localizes and formats it.
    pub timestamp: String,
    pub actor_id: Option<String>,
    pub actor_email: Option<String>,
    pub action: String,
    pub category: String,
    pub label: String,
    pub severity: AuditSeverity,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub context: Option<serde_json::Value>,
}

impl From<AuditRowRaw> for AdminAuditLogRow {
    fn from(raw: AuditRowRaw) -> Self {
        AdminAuditLogRow {
            timestamp: raw.created_at.to_rfc3339(),
            category: audit_catalog::category_of(&raw.action).to_string(),
            label: audit_catalog::label_of(
                &raw.action,
                raw.resource_type.as_deref(),
                raw.resource_id.as_deref(),
            ),
            severity: audit_catalog::severity_of(&raw.action),
            id: raw.id,
            actor_id: raw.actor_id,
            actor_email: raw.actor_email,
            action: raw.action,
            resource_type: raw.resource_type,
            resource_id: raw.resource_id,
            ip: raw.ip,
            user_agent: raw.user_agent,
            context: raw.context,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AdminAuditLogsResponse {
    pub rows: Vec<AdminAuditLogRow>,
    pub total_matching: i64,
    pub has_more: bool,
    /// Human: Pass back as `cursor` to fetch the next page; null when the list is exhausted.
    pub next_cursor: Option<String>,
}

// Human: One page of audit events matching the active filter.
// Agent: GET /api/v1/admin/audit-logs; keyset paginated; AUDIT exempt.
pub async fn list_audit_logs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<AuditLogsQuery>,
) -> Result<Json<AdminAuditLogsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAuditRead).await?;

    let filter = query.to_filter()?;
    let sort = AuditSort::parse(query.sort.as_deref());
    let cursor = query.cursor.as_deref().and_then(AuditCursor::parse);
    let limit = query.page_limit();

    let mut raw: Vec<AuditRowRaw> = filter
        .rows_query(sort, cursor.as_ref(), limit)
        .build_query_as()
        .fetch_all(&state.pool)
        .await?;

    // Human: rows_query over-fetches one row purely to answer "is there another page?".
    let has_more = raw.len() as i64 > limit;
    raw.truncate(limit as usize);

    let next_cursor = if has_more {
        raw.last().map(|row| {
            AuditCursor {
                created_at: row.created_at,
                id: row.id.clone(),
            }
            .encode()
        })
    } else {
        None
    };

    let total_matching: (i64,) = filter
        .count_query()
        .build_query_as()
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(AdminAuditLogsResponse {
        rows: raw.into_iter().map(AdminAuditLogRow::from).collect(),
        total_matching: total_matching.0,
        has_more,
        next_cursor,
    }))
}

#[derive(Debug, Serialize)]
pub struct AuditFacetBucket {
    pub key: String,
    pub label: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminAuditSummary {
    pub total: i64,
    pub elevated: i64,
    pub distinct_actors: i64,
    pub busiest_action: Option<String>,
    pub busiest_action_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AdminAuditFacetsResponse {
    pub categories: Vec<AuditFacetBucket>,
    pub severities: Vec<AuditFacetBucket>,
    pub actions: Vec<AuditFacetBucket>,
    pub actors: Vec<AuditFacetBucket>,
    pub summary: AdminAuditSummary,
    /// Human: Effective export ceiling (0 = unlimited) so the panel can warn before a truncated export.
    /// Agent: Served here, not from /admin/settings — auditors may lack InstanceSettingsRead.
    pub export_max_rows: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct FacetRow {
    facet_key: Option<String>,
    facet_count: i64,
}

async fn fetch_facet(
    pool: &PgPool,
    mut builder: QueryBuilder<'_, Postgres>,
) -> Result<Vec<FacetRow>, AppError> {
    Ok(builder.build_query_as().fetch_all(pool).await?)
}

// Human: Facet counts and summary metrics for the active filter.
// Agent: GET /api/v1/admin/audit-logs/facets; grouped aggregates only — never a full-table fetch.
pub async fn audit_log_facets(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<AuditLogsQuery>,
) -> Result<Json<AdminAuditFacetsResponse>, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAuditRead).await?;

    let filter = query.to_filter()?;

    // Human: Each facet excludes its own dimension, so counts show what adding that filter would yield.
    let category_rows = fetch_facet(
        &state.pool,
        filter.facet_query("a.action_namespace", FacetDimension::Category, None),
    )
    .await?;

    // Human: Severity is a catalog property, so it is folded in Rust from per-action counts.
    let severity_source = fetch_facet(
        &state.pool,
        filter.facet_query("a.action", FacetDimension::Severity, None),
    )
    .await?;

    let action_rows = fetch_facet(
        &state.pool,
        filter.facet_query("a.action", FacetDimension::Action, Some(FACET_TOP_N)),
    )
    .await?;

    let actor_rows = fetch_facet(
        &state.pool,
        filter.facet_query(
            "COALESCE(u.email, 'system')",
            FacetDimension::Actor,
            Some(FACET_TOP_N),
        ),
    )
    .await?;

    let busiest = fetch_facet(
        &state.pool,
        filter.facet_query("a.action", FacetDimension::None, Some(1)),
    )
    .await?;

    let summary_row: (i64, i64, i64) = filter
        .summary_query()
        .build_query_as()
        .fetch_one(&state.pool)
        .await?;

    let categories = category_rows
        .into_iter()
        .map(|row| {
            let key = row.facet_key.unwrap_or_else(|| "unknown".into());
            AuditFacetBucket {
                label: key.clone(),
                key,
                count: row.facet_count,
            }
        })
        .collect();

    let mut severity_counts: Vec<(AuditSeverity, i64)> =
        AuditSeverity::ALL.iter().map(|s| (*s, 0)).collect();
    for row in severity_source {
        let action = row.facet_key.unwrap_or_default();
        let severity = audit_catalog::severity_of(&action);
        if let Some(entry) = severity_counts.iter_mut().find(|(s, _)| *s == severity) {
            entry.1 += row.facet_count;
        }
    }
    let severities = severity_counts
        .into_iter()
        .map(|(severity, count)| AuditFacetBucket {
            key: severity.as_str().to_string(),
            label: severity.as_str().to_string(),
            count,
        })
        .collect();

    let actions = action_rows
        .into_iter()
        .map(|row| {
            let key = row.facet_key.unwrap_or_default();
            AuditFacetBucket {
                label: audit_catalog::label_of(&key, None, None),
                key,
                count: row.facet_count,
            }
        })
        .collect();

    let actors = actor_rows
        .into_iter()
        .map(|row| {
            let key = row.facet_key.unwrap_or_else(|| "system".into());
            AuditFacetBucket {
                label: key.clone(),
                key,
                count: row.facet_count,
            }
        })
        .collect();

    let (busiest_action, busiest_action_count) = busiest
        .into_iter()
        .next()
        .map(|row| (row.facet_key, row.facet_count))
        .unwrap_or((None, 0));

    Ok(Json(AdminAuditFacetsResponse {
        categories,
        severities,
        actions,
        actors,
        summary: AdminAuditSummary {
            total: summary_row.0,
            distinct_actors: summary_row.1,
            elevated: summary_row.2,
            busiest_action,
            busiest_action_count,
        },
        export_max_rows: export_max_rows(&state.pool).await,
    }))
}

// Human: Quote one CSV field, doubling embedded quotes per RFC 4180.
fn csv_cell(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn csv_line(cells: &[String]) -> String {
    let mut line = cells
        .iter()
        .map(|cell| csv_cell(cell))
        .collect::<Vec<_>>()
        .join(",");
    line.push('\n');
    line
}

const EXPORT_HEADER: [&str; 11] = [
    "Timestamp",
    "Actor",
    "Action",
    "Category",
    "Severity",
    "Description",
    "Resource Type",
    "Resource ID",
    "IP",
    "User Agent",
    "Context",
];

fn export_row_cells(row: &AdminAuditLogRow) -> Vec<String> {
    vec![
        row.timestamp.clone(),
        row.actor_email.clone().unwrap_or_else(|| "system".into()),
        row.action.clone(),
        row.category.clone(),
        row.severity.as_str().to_string(),
        row.label.clone(),
        row.resource_type.clone().unwrap_or_default(),
        row.resource_id.clone().unwrap_or_default(),
        row.ip.clone().unwrap_or_default(),
        row.user_agent.clone().unwrap_or_default(),
        row.context
            .as_ref()
            .map(|value| value.to_string())
            .unwrap_or_default(),
    ]
}

/// Human: Where the CSV stream is in its lifecycle — header, row batches, then footer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExportPhase {
    Header,
    Rows,
    Footer,
}

/// Human: Carried across stream steps so each batch resumes where the last stopped.
struct ExportState {
    phase: ExportPhase,
    cursor: Option<AuditCursor>,
    emitted: i64,
}

// Human: Footer stating what was left out — an export must never misrepresent its own completeness.
fn truncation_footer(emitted: i64, total_matching: i64, cap: i64) -> String {
    format!(
        "# Export truncated at {emitted} of {total_matching} matching events \
         (audit_export_max_rows = {cap}). Raise the limit in System Settings to export more.\n"
    )
}

// Human: Stream the whole filtered ledger as CSV, capped by the admin-configured row limit.
// Agent: GET /api/v1/admin/audit-logs/export.csv; lazily pages EXPORT_BATCH_ROWS at a time — memory stays flat.
pub async fn export_audit_logs(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<AuditLogsQuery>,
) -> Result<Response, AppError> {
    require_instance_permission(&state.pool, &claims, Permission::InstanceAuditRead).await?;

    let filter = query.to_filter()?;
    let sort = AuditSort::parse(query.sort.as_deref());
    let cap = export_max_rows(&state.pool).await;

    // Human: Counted up front so the footer can name the true total even after truncation.
    let total_matching: (i64,) = filter
        .count_query()
        .build_query_as()
        .fetch_one(&state.pool)
        .await?;
    let total_matching = total_matching.0;

    let pool = state.pool.clone();
    let filename = format!("audit-logs-{}.csv", Utc::now().format("%Y%m%d-%H%M%S"));

    // Human: Unfold pages lazily so a multi-million-row export never materializes in memory.
    // Agent: Each step yields one chunk; DB errors surface as a comment line, not a silently short file.
    let body_stream = stream::unfold(
        Some(ExportState {
            phase: ExportPhase::Header,
            cursor: None,
            emitted: 0,
        }),
        move |state| {
            let pool = pool.clone();
            let filter = filter.clone();
            async move {
                let state = state?;

                match state.phase {
                    ExportPhase::Header => Some((
                        csv_line(&EXPORT_HEADER.map(str::to_string)),
                        Some(ExportState {
                            phase: ExportPhase::Rows,
                            ..state
                        }),
                    )),

                    ExportPhase::Rows => {
                        if cap > 0 && state.emitted >= cap {
                            return Some((
                                String::new(),
                                Some(ExportState {
                                    phase: ExportPhase::Footer,
                                    ..state
                                }),
                            ));
                        }

                        let batch_limit = if cap > 0 {
                            EXPORT_BATCH_ROWS.min(cap - state.emitted)
                        } else {
                            EXPORT_BATCH_ROWS
                        };

                        let fetched: Result<Vec<AuditRowRaw>, sqlx::Error> = filter
                            .rows_query(sort, state.cursor.as_ref(), batch_limit)
                            .build_query_as()
                            .fetch_all(&pool)
                            .await;

                        let mut raw = match fetched {
                            Ok(raw) => raw,
                            Err(err) => {
                                // Human: Headers are already sent, so the failure is reported in-band.
                                tracing::error!(error = %err, "audit export query failed mid-stream");
                                return Some((
                                    format!("# Export failed after {} rows: {err}\n", state.emitted),
                                    None,
                                ));
                            }
                        };

                        // Human: rows_query over-fetches one row to reveal whether more remain.
                        let exhausted = raw.len() as i64 <= batch_limit;
                        raw.truncate(batch_limit as usize);
                        if raw.is_empty() {
                            return Some((
                                String::new(),
                                Some(ExportState {
                                    phase: ExportPhase::Footer,
                                    ..state
                                }),
                            ));
                        }

                        let cursor = raw.last().map(|row| AuditCursor {
                            created_at: row.created_at,
                            id: row.id.clone(),
                        });
                        let emitted = state.emitted + raw.len() as i64;

                        let mut chunk = String::new();
                        for row in raw {
                            chunk.push_str(&csv_line(&export_row_cells(&AdminAuditLogRow::from(row))));
                        }

                        Some((
                            chunk,
                            Some(ExportState {
                                phase: if exhausted {
                                    ExportPhase::Footer
                                } else {
                                    ExportPhase::Rows
                                },
                                cursor,
                                emitted,
                            }),
                        ))
                    }

                    ExportPhase::Footer => {
                        let footer = if cap > 0 && total_matching > state.emitted {
                            truncation_footer(state.emitted, total_matching, cap)
                        } else {
                            String::new()
                        };
                        Some((footer, None))
                    }
                }
            }
        },
    )
    .map(Ok::<String, std::io::Error>);

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        Body::from_stream(body_stream),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query_with(severities: Option<&str>, from: Option<&str>, to: Option<&str>) -> AuditLogsQuery {
        AuditLogsQuery {
            severities: severities.map(str::to_string),
            from: from.map(str::to_string),
            to: to.map(str::to_string),
            ..Default::default()
        }
    }

    // Human: Comma-separated filter values must split cleanly, ignoring blanks and padding.
    #[test]
    fn csv_filter_values_split_and_trim() {
        let raw = "files, auth ,,shares".to_string();
        assert_eq!(
            split_csv(Some(&raw)),
            vec!["files", "auth", "shares"]
        );
        assert!(split_csv(None).is_empty());
    }

    // Human: An unrecognized severity must fail loudly rather than silently matching everything.
    #[test]
    fn unknown_severity_is_rejected() {
        let err = query_with(Some("critical,bogus"), None, None)
            .to_filter()
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn valid_severities_parse() {
        let filter = query_with(Some("critical,warning"), None, None)
            .to_filter()
            .expect("valid severities");
        assert_eq!(
            filter.severities,
            vec![AuditSeverity::Critical, AuditSeverity::Warning]
        );
    }

    // Human: A malformed date bound must not be dropped — that would show the wrong window.
    #[test]
    fn malformed_date_is_rejected() {
        let err = query_with(None, Some("last-tuesday"), None)
            .to_filter()
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn inverted_range_is_rejected() {
        let err = query_with(None, Some("2026-08-02T00:00:00Z"), Some("2026-08-01T00:00:00Z"))
            .to_filter()
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn valid_range_parses() {
        let filter = query_with(None, Some("2026-08-01T00:00:00Z"), Some("2026-08-02T00:00:00Z"))
            .to_filter()
            .expect("valid range");
        assert!(filter.from.is_some() && filter.to.is_some());
    }

    // Human: Page size is clamped so a hostile limit cannot pull the whole ledger.
    #[test]
    fn page_limit_is_clamped() {
        let mut query = AuditLogsQuery::default();
        assert_eq!(query.page_limit(), DEFAULT_PAGE_ROWS);
        query.limit = Some(10_000);
        assert_eq!(query.page_limit(), MAX_PAGE_ROWS);
        query.limit = Some(0);
        assert_eq!(query.page_limit(), 1);
        query.limit = Some(-5);
        assert_eq!(query.page_limit(), 1);
    }

    // Human: CSV cells must survive embedded quotes, commas, and newlines.
    #[test]
    fn csv_cells_are_quoted_and_escaped() {
        assert_eq!(csv_cell("plain"), "\"plain\"");
        assert_eq!(csv_cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_cell("a,b"), "\"a,b\"");
        assert_eq!(csv_cell("line\nbreak"), "\"line\nbreak\"");
    }

    // Human: The footer must name both the cap and the true total, or truncation is undiscoverable.
    #[test]
    fn truncation_footer_states_cap_and_true_total() {
        let footer = truncation_footer(100_000, 2_340_112, 100_000);
        assert!(footer.contains("100000 of 2340112"));
        assert!(footer.contains("audit_export_max_rows = 100000"));
        assert!(footer.starts_with('#') && footer.ends_with('\n'));
    }

    #[test]
    fn csv_header_matches_row_width() {
        let row = AdminAuditLogRow {
            id: "1".into(),
            timestamp: "2026-08-01T00:00:00Z".into(),
            actor_id: None,
            actor_email: None,
            action: "auth.login".into(),
            category: "auth".into(),
            label: "User signed in".into(),
            severity: AuditSeverity::Notice,
            resource_type: None,
            resource_id: None,
            ip: None,
            user_agent: None,
            context: None,
        };
        assert_eq!(export_row_cells(&row).len(), EXPORT_HEADER.len());
    }

    // Human: A row with no actor exports as "system", not an empty cell.
    #[test]
    fn missing_actor_exports_as_system() {
        let row = AdminAuditLogRow {
            id: "1".into(),
            timestamp: "2026-08-01T00:00:00Z".into(),
            actor_id: None,
            actor_email: None,
            action: "recycle_bin.expired".into(),
            category: "recycle_bin".into(),
            label: "Recycle bin items expired and were purged".into(),
            severity: AuditSeverity::Warning,
            resource_type: None,
            resource_id: None,
            ip: None,
            user_agent: None,
            context: None,
        };
        assert_eq!(export_row_cells(&row)[1], "system");
    }
}
