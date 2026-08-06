// Human: Starred files for the signed-in account — list, star, unstar.
// Agent: OWNER-SCOPED; ids the caller does not own are ignored rather than erroring.

use axum::{extract::State, Extension, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{auth::handlers::Claims, error::AppError, AppState};

/// Human: Cap on one star/unstar request — also bounds the web client's one-time localStorage import.
const MAX_FAVOURITE_IDS: usize = 500;

#[derive(Debug, Serialize)]
pub struct FavouriteListResponse {
    pub file_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct FavouriteIdsRequest {
    pub file_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct FavouriteMutationResponse {
    pub file_ids: Vec<String>,
    pub changed: u64,
}

// Human: Normalise a request's id list — deduped, bounded, and never empty-string.
fn normalize_ids(mut ids: Vec<String>) -> Result<Vec<String>, AppError> {
    ids.retain(|id| !id.trim().is_empty());
    ids.sort();
    ids.dedup();
    if ids.len() > MAX_FAVOURITE_IDS {
        return Err(AppError::BadRequest(format!(
            "at most {MAX_FAVOURITE_IDS} file ids can be changed at once"
        )));
    }
    Ok(ids)
}

// Human: Every file this account has starred, newest star first.
// Agent: GET /favourites; JOINS files to skip rows in the recycle bin.
pub async fn list_favourites(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<FavouriteListResponse>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT fav.file_id FROM file_favourites fav \
         JOIN files f ON f.id = fav.file_id \
         WHERE fav.user_id = $1 AND f.user_id = $1 AND f.deleted_at IS NULL \
         ORDER BY fav.created_at DESC",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(FavouriteListResponse {
        file_ids: rows.into_iter().map(|(id,)| id).collect(),
    }))
}

// Human: Star one or more files the caller owns.
// Agent: POST /favourites; INSERT ... SELECT filters foreign/trashed ids; ON CONFLICT keeps it idempotent.
pub async fn add_favourites(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<FavouriteIdsRequest>,
) -> Result<Json<FavouriteMutationResponse>, AppError> {
    let ids = normalize_ids(body.file_ids)?;
    if ids.is_empty() {
        return Ok(Json(FavouriteMutationResponse {
            file_ids: Vec::new(),
            changed: 0,
        }));
    }

    let result = sqlx::query(
        "INSERT INTO file_favourites (user_id, file_id) \
         SELECT $1, f.id FROM files f \
         WHERE f.id = ANY($2) AND f.user_id = $1 AND f.deleted_at IS NULL \
         ON CONFLICT (user_id, file_id) DO NOTHING",
    )
    .bind(&claims.sub)
    .bind(&ids)
    .execute(&state.pool)
    .await?;

    Ok(Json(FavouriteMutationResponse {
        file_ids: ids,
        changed: result.rows_affected(),
    }))
}

// Human: Remove the star from one or more files.
// Agent: DELETE /favourites; scoped to the caller's own rows.
pub async fn remove_favourites(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<FavouriteIdsRequest>,
) -> Result<Json<FavouriteMutationResponse>, AppError> {
    let ids = normalize_ids(body.file_ids)?;
    if ids.is_empty() {
        return Ok(Json(FavouriteMutationResponse {
            file_ids: Vec::new(),
            changed: 0,
        }));
    }

    let result = sqlx::query("DELETE FROM file_favourites WHERE user_id = $1 AND file_id = ANY($2)")
        .bind(&claims.sub)
        .bind(&ids)
        .execute(&state.pool)
        .await?;

    Ok(Json(FavouriteMutationResponse {
        file_ids: ids,
        changed: result.rows_affected(),
    }))
}
