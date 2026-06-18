// Human: Resolve the spooled upload source file before finalize — append-on-write or legacy parts merge.
// Agent: READS work_dir/source when present; FALLBACK concatenates work_dir/parts/{n} for older spools.

use std::path::{Path, PathBuf};

use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use crate::error::AppError;

use super::store::{total_parts, UploadSessionRow};

// Human: Open the assembled source blob, preferring seek-written `source` over legacy part files.
// Agent: CALLS after all parts received; RETURNS tmp_path + verified size_bytes for finalize.
pub async fn resolve_session_source(
    session: &UploadSessionRow,
    work_dir: &Path,
) -> Result<(PathBuf, u64), AppError> {
    let source_path = work_dir.join("source");
    if tokio::fs::try_exists(&source_path)
        .await
        .unwrap_or(false)
    {
        let metadata = tokio::fs::metadata(&source_path).await.map_err(|error| {
            AppError::Internal(anyhow::anyhow!("stat assembled upload source: {error}"))
        })?;
        if metadata.len() as i64 != session.total_size {
            return Err(AppError::BadRequest(format!(
                "assembled size {} does not match expected {}",
                metadata.len(),
                session.total_size
            )));
        }
        return Ok((source_path, metadata.len()));
    }

    assemble_session_parts_from_legacy_parts(session, work_dir).await
}

// Human: Merge ordered legacy part files into one spool file before finalize.
// Agent: READS work_dir/parts/{n}; WRITES work_dir/source; VERIFIES total byte count.
async fn assemble_session_parts_from_legacy_parts(
    session: &UploadSessionRow,
    work_dir: &Path,
) -> Result<(PathBuf, u64), AppError> {
    let parts_dir = work_dir.join("parts");
    let tmp_path = work_dir.join("source");
    let chunk_size = session.chunk_size as i64;
    let parts = total_parts(session.total_size, chunk_size);

    if parts == 0 {
        return Err(AppError::BadRequest("upload session has zero parts".into()));
    }

    let mut out = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("create assembled upload file: {error}")))?;

    let mut total_written: u64 = 0;

    for part_number in 0..parts {
        let part_path = parts_dir.join(format!("{part_number}"));
        let mut part_file = tokio::fs::File::open(&part_path).await.map_err(|error| {
            AppError::BadRequest(format!("missing upload part {part_number}: {error}"))
        })?;
        let copied = tokio::io::copy(&mut part_file, &mut out)
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!("assemble upload part: {error}")))?;
        total_written += copied;
    }

    out.flush()
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("flush assembled upload file: {error}")))?;

    if total_written as i64 != session.total_size {
        return Err(AppError::BadRequest(format!(
            "assembled size {total_written} does not match expected {}",
            session.total_size
        )));
    }

    Ok((tmp_path, total_written))
}

// Human: Write one upload part at the correct byte offset inside the spool source file.
// Agent: SEEK to part_number * chunk_size; APPEND body; SUPPORTS out-of-order parallel PUTs.
pub async fn append_part_to_source(
    work_dir: &Path,
    part_number: i32,
    chunk_size: i64,
    body: &[u8],
) -> Result<(), AppError> {
    let source_path = work_dir.join("source");
    let offset = (part_number as i64) * chunk_size;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&source_path)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("open upload source: {error}")))?;

    file.seek(std::io::SeekFrom::Start(offset as u64))
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("seek upload source: {error}")))?;
    file.write_all(body)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("write upload part: {error}")))?;
    file.flush()
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("flush upload part: {error}")))?;

    Ok(())
}
