// Human: Concatenate received upload parts into one spool file before finalize.
// Agent: READS work_dir/parts/{n}; WRITES work_dir/source; VERIFIES total byte count.

use std::path::{Path, PathBuf};

use tokio::io::AsyncWriteExt;

use crate::error::AppError;

use super::store::{total_parts, UploadSessionRow};

// Human: Merge ordered part files into a single source blob on disk.
// Agent: CALLS after all parts received; RETURNS tmp_path + verified size_bytes.
pub async fn assemble_session_parts(
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
