// Human: Resource ACL HTTP handlers — list and mutate permission_grants on files/folders/instance.
// Agent: GET/PUT/DELETE /api/v1/permissions*; REQUIRES content.read or manage_acl.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::Deserialize;

use crate::{
    authz::{
        authorize, authorize_instance, list_grants_for_resource, revoke_grant_by_id, upsert_grant,
        Permission, ResourceRef, UpsertGrantRequest,
    },
    auth::handlers::Claims,
    error::AppError,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListPermissionsQuery {
    pub resource_type: String,
    pub resource_id: Option<String>,
}

// Human: List atomic grants on one resource for ACL/share UI.
// Agent: GET /permissions; CALLER needs content.read OR manage_acl OR instance.permissions.manage.
pub async fn list_permissions(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListPermissionsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let resource_type = query.resource_type.trim().to_lowercase();
    if resource_type == "instance" && query.resource_id.is_some() {
        return Err(AppError::BadRequest(
            "instance grants must not include resource_id".into(),
        ));
    }
    if resource_type != "instance" && query.resource_id.as_deref().unwrap_or("").is_empty() {
        return Err(AppError::BadRequest("resource_id is required".into()));
    }

    let can_manage = authorize_instance(
        &state.pool,
        &claims.sub,
        Permission::InstancePermissionsManage,
    )
    .await
    .is_ok();

    if !can_manage {
        let resource = match resource_type.as_str() {
            "folder" => ResourceRef::Folder(query.resource_id.clone().unwrap()),
            "file" => ResourceRef::File(query.resource_id.clone().unwrap()),
            "instance" => ResourceRef::Instance,
            _ => return Err(AppError::BadRequest("invalid resource_type".into())),
        };
        let readable = authorize(&state.pool, &claims.sub, Permission::ContentRead, resource.clone())
            .await
            .is_ok();
        let acl = authorize(
            &state.pool,
            &claims.sub,
            Permission::ContentManageAcl,
            resource,
        )
        .await
        .is_ok();
        if !readable && !acl {
            return Err(AppError::Forbidden(
                "you do not have permission to view ACLs on this resource".into(),
            ));
        }
    }

    let grants = list_grants_for_resource(
        &state.pool,
        &resource_type,
        query.resource_id.as_deref(),
    )
    .await?;

    Ok(Json(serde_json::json!({ "grants": grants })))
}

// Human: Create or update one atomic grant row.
// Agent: PUT /permissions; DELEGATES authz::upsert_grant.
pub async fn put_permission(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<UpsertGrantRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let grant = upsert_grant(&state.pool, &claims.sub, &headers, body).await?;
    Ok(Json(serde_json::json!({ "grant": grant })))
}

// Human: List groups available for ACL grants on a file/folder (share dialog group picker).
// Agent: GET /permissions/assignable-groups; REQUIRES content.share on resource.
pub async fn list_assignable_groups(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListPermissionsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let resource_type = query.resource_type.trim().to_lowercase();
    if resource_type != "file" && resource_type != "folder" {
        return Err(AppError::BadRequest(
            "resource_type must be file or folder".into(),
        ));
    }
    let resource_id = query
        .resource_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| AppError::BadRequest("resource_id is required".into()))?;

    let resource = match resource_type.as_str() {
        "folder" => ResourceRef::Folder(resource_id.to_string()),
        "file" => ResourceRef::File(resource_id.to_string()),
        _ => unreachable!(),
    };
    authorize(
        &state.pool,
        &claims.sub,
        Permission::ContentShare,
        resource,
    )
    .await?;

    let groups: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, slug, name FROM groups ORDER BY is_system DESC, slug ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    let items: Vec<serde_json::Value> = groups
        .into_iter()
        .map(|(id, slug, name)| {
            serde_json::json!({ "id": id, "slug": slug, "name": name })
        })
        .collect();

    Ok(Json(serde_json::json!({ "groups": items })))
}

// Human: Remove one grant by id.
// Agent: DELETE /permissions/:id; AUDIT permissions.revoke via grants module.
pub async fn delete_permission(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    revoke_grant_by_id(&state.pool, &claims.sub, &headers, &id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
