// Human: Render PDF and spreadsheet bytes into high-fidelity explorer preview JPEG sidecars.
// Agent: PDF via pdftoppm page 1; spreadsheets via in-app grid renderer; RETURNS JPEG bytes.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::image::thumbnail::{encode_jpeg, resize_to_max_edge};

use super::mime;
use super::spreadsheet_preview;

/// Human: Longest edge for stored document preview JPEGs — higher than image grid tiles for readable text.
pub const DOCUMENT_PREVIEW_MAX_EDGE: u32 = 1200;

const DOCUMENT_PREVIEW_JPEG_QUALITY: u8 = 90;

const PDF_RENDER_DPI: u32 = 144;

// Human: Dispatch to PDF or spreadsheet renderer based on mime + filename.
// Agent: CALLED by thumbnail worker after loading source bytes/path.
pub fn generate_document_grid_thumbnail_jpeg(
    source_bytes: &[u8],
    mime_type: &str,
    filename: &str,
    source_path: Option<&Path>,
) -> Result<Vec<u8>, String> {
    if mime::is_pdf_mime(mime_type) {
        return generate_pdf_preview_jpeg(source_bytes, source_path);
    }
    if mime::is_spreadsheet_preview_mime(mime_type, filename) {
        return spreadsheet_preview::generate_spreadsheet_preview_jpeg(source_bytes, filename);
    }
    Err("file type does not support document grid thumbnail".into())
}

// Human: Rasterize PDF page one at print-like resolution, then encode a bounded JPEG sidecar.
// Agent: SPAWNS pdftoppm -r DPI -f 1 -l 1; RESIZES when above DOCUMENT_PREVIEW_MAX_EDGE.
fn generate_pdf_preview_jpeg(
    source_bytes: &[u8],
    source_path: Option<&Path>,
) -> Result<Vec<u8>, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("temp dir failed: {e}"))?;
    let pdf_path = resolve_source_path(
        source_bytes,
        source_path,
        &temp_dir.path().join("source.pdf"),
    )?;
    rasterize_pdf_first_page_jpeg(&pdf_path)
}

// Human: Prefer the upload spool path when still present; otherwise write bytes into scratch storage.
// Agent: READS source_path when it exists; WRITES source_bytes to fallback_path on miss.
fn resolve_source_path(
    source_bytes: &[u8],
    source_path: Option<&Path>,
    fallback_path: &Path,
) -> Result<PathBuf, String> {
    if let Some(path) = source_path {
        if path.exists() {
            return Ok(path.to_path_buf());
        }
    }
    std::fs::write(fallback_path, source_bytes)
        .map_err(|e| format!("write source temp failed: {e}"))?;
    Ok(fallback_path.to_path_buf())
}

// Human: Shared raster path for PDF page-one previews.
// Agent: SPAWNS pdftoppm; DECODES JPEG; DOWNSCALES with aspect ratio; RE-ENCODES preview JPEG.
fn rasterize_pdf_first_page_jpeg(pdf_path: &Path) -> Result<Vec<u8>, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("temp dir failed: {e}"))?;
    let output_prefix = temp_dir.path().join("page");

    let status = Command::new("pdftoppm")
        .arg("-jpeg")
        .arg("-singlefile")
        .arg("-f")
        .arg("1")
        .arg("-l")
        .arg("1")
        .arg("-r")
        .arg(PDF_RENDER_DPI.to_string())
        .arg(pdf_path)
        .arg(&output_prefix)
        .status()
        .map_err(|e| format!("pdftoppm spawn failed (install poppler-utils): {e}"))?;

    if !status.success() {
        return Err("pdftoppm failed to render document preview".into());
    }

    let jpeg_path = temp_dir.path().join("page.jpg");
    let jpeg_bytes =
        std::fs::read(&jpeg_path).map_err(|e| format!("read pdftoppm output failed: {e}"))?;
    if jpeg_bytes.len() < 128 {
        return Err("pdftoppm produced empty document preview".into());
    }

    let decoded = image::ImageReader::new(std::io::Cursor::new(jpeg_bytes))
        .with_guessed_format()
        .map_err(|e| format!("preview jpeg format guess failed: {e}"))?
        .decode()
        .map_err(|e| format!("preview jpeg decode failed: {e}"))?;

    let bounded = resize_to_max_edge(decoded, DOCUMENT_PREVIEW_MAX_EDGE);
    encode_jpeg(&bounded, DOCUMENT_PREVIEW_JPEG_QUALITY)
}
