// Human: Render PDF and spreadsheet bytes into explorer grid JPEG sidecars.
// Agent: CALLED by document thumbnail worker; RETURNS JPEG bytes for Nebular PUT.

use std::path::Path;
use std::process::Command;

use calamine::{open_workbook_auto, Data, Reader};
use fontdue::Font;
use image::{ImageBuffer, Rgb, RgbImage};

use crate::image::thumbnail::{encode_jpeg, resize_to_max_edge, GRID_THUMBNAIL_MAX_EDGE};

use super::mime;

const SPREADSHEET_MAX_ROWS: usize = 7;
const SPREADSHEET_MAX_COLS: usize = 5;
const CELL_TEXT_MAX_LEN: usize = 10;
const SPREADSHEET_HEADER_BAR_PX: u32 = 6;
const SPREADSHEET_JPEG_QUALITY: u8 = 82;

// Human: Pick a readable sans font from common OS paths for spreadsheet cell labels.
// Agent: READS DejaVu/Arial TTF; RETURNS None when no font is available (grid-only fallback).
fn load_spreadsheet_font() -> Option<Font> {
    const FONT_PATHS: &[&str] = &[
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ];

    for path in FONT_PATHS {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        if let Ok(font) = Font::from_bytes(bytes, fontdue::FontSettings::default()) {
            return Some(font);
        }
    }
    None
}

// Human: Dispatch to PDF or spreadsheet renderer based on mime + filename.
// Agent: CALLED by thumbnail worker after loading source bytes/path.
pub fn generate_document_grid_thumbnail_jpeg(
    source_bytes: &[u8],
    mime_type: &str,
    filename: &str,
    source_path: Option<&Path>,
) -> Result<Vec<u8>, String> {
    if mime::is_pdf_mime(mime_type) {
        return generate_pdf_grid_thumbnail_jpeg(source_bytes, source_path);
    }
    if mime::is_spreadsheet_preview_mime(mime_type, filename) {
        return generate_spreadsheet_grid_thumbnail_jpeg(source_bytes);
    }
    Err("file type does not support document grid thumbnail".into())
}

// Human: Render the first PDF page to a bounded JPEG using poppler pdftoppm.
// Agent: SPAWNS pdftoppm -jpeg -singlefile -scale-to; READS temp output bytes.
fn generate_pdf_grid_thumbnail_jpeg(
    source_bytes: &[u8],
    source_path: Option<&Path>,
) -> Result<Vec<u8>, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("temp dir failed: {e}"))?;
    let input_path = if let Some(path) = source_path {
        if path.exists() {
            path.to_path_buf()
        } else {
            let path = temp_dir.path().join("source.pdf");
            std::fs::write(&path, source_bytes)
                .map_err(|e| format!("write pdf temp failed: {e}"))?;
            path
        }
    } else {
        let path = temp_dir.path().join("source.pdf");
        std::fs::write(&path, source_bytes).map_err(|e| format!("write pdf temp failed: {e}"))?;
        path
    };

    let output_prefix = temp_dir.path().join("page");
    let status = Command::new("pdftoppm")
        .arg("-jpeg")
        .arg("-singlefile")
        .arg("-scale-to")
        .arg(GRID_THUMBNAIL_MAX_EDGE.to_string())
        .arg(&input_path)
        .arg(&output_prefix)
        .status()
        .map_err(|e| format!("pdftoppm spawn failed (install poppler-utils): {e}"))?;

    if !status.success() {
        return Err("pdftoppm failed to render pdf preview".into());
    }

    let jpeg_path = temp_dir.path().join("page.jpg");
    let jpeg = std::fs::read(&jpeg_path).map_err(|e| format!("read pdftoppm output failed: {e}"))?;
    if jpeg.len() < 128 {
        return Err("pdftoppm produced empty pdf preview".into());
    }

    Ok(jpeg)
}

// Human: Draw a mini worksheet grid matching the explorer spreadsheet tile layout.
// Agent: READS first sheet via calamine; RENDERS green header + bordered cells to JPEG.
fn generate_spreadsheet_grid_thumbnail_jpeg(source_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let matrix = spreadsheet_matrix_from_bytes(source_bytes)?;
    if matrix.is_empty() {
        return Err("spreadsheet has no previewable cells".into());
    }

    let cols = matrix
        .iter()
        .map(|row| row.len())
        .max()
        .unwrap_or(SPREADSHEET_MAX_COLS)
        .max(1);
    let rows = matrix.len().max(1);

    let size = GRID_THUMBNAIL_MAX_EDGE;
    let mut image: RgbImage = ImageBuffer::from_pixel(size, size, Rgb([255, 255, 255]));
    let grid_top = SPREADSHEET_HEADER_BAR_PX;
    let grid_height = size.saturating_sub(grid_top);
    let cell_width = (size / cols as u32).max(1);
    let cell_height = (grid_height / rows as u32).max(1);

    for x in 0..size {
        for y in 0..SPREADSHEET_HEADER_BAR_PX {
            image.put_pixel(x, y, Rgb([16, 124, 65]));
        }
    }

    let font = load_spreadsheet_font();
    let font_size = (cell_height.saturating_sub(4).max(8) as f32).min(14.0);

    for (row_index, row) in matrix.iter().enumerate() {
        for (col_index, cell) in row.iter().enumerate() {
            let x0 = col_index as u32 * cell_width;
            let y0 = grid_top + row_index as u32 * cell_height;
            let bg = if row_index == 0 {
                Rgb([250, 250, 250])
            } else {
                Rgb([255, 255, 255])
            };
            fill_rect(&mut image, x0, y0, cell_width, cell_height, bg);
            stroke_rect(&mut image, x0, y0, cell_width, cell_height, Rgb([229, 231, 235]));

            if let Some(font) = &font {
                let mut cursor_x = x0 as i32 + 2;
                for ch in cell.chars().take(CELL_TEXT_MAX_LEN + 1) {
                    let (metrics, bitmap) = font.rasterize(ch, font_size);
                    blit_text_bitmap(
                        &mut image,
                        cursor_x,
                        y0 as i32 + 2,
                        &bitmap,
                        metrics.width,
                        metrics.height,
                        if row_index == 0 {
                            Rgb([102, 102, 102])
                        } else {
                            Rgb([26, 26, 26])
                        },
                    );
                    cursor_x += metrics.advance_width as i32;
                }
            }
        }
    }

    let dynamic = resize_to_max_edge(image::DynamicImage::ImageRgb8(image), GRID_THUMBNAIL_MAX_EDGE);
    encode_jpeg(&dynamic, SPREADSHEET_JPEG_QUALITY)
}

// Human: Extract a truncated string matrix from the first worksheet tab.
// Agent: READS calamine workbook; LIMITS rows/cols to explorer tile budget.
fn spreadsheet_matrix_from_bytes(source_bytes: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("temp dir failed: {e}"))?;
    let path = temp_dir.path().join("source.bin");
    std::fs::write(&path, source_bytes).map_err(|e| format!("write spreadsheet temp failed: {e}"))?;
    let mut workbook =
        open_workbook_auto(&path).map_err(|e| format!("spreadsheet open failed: {e}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "spreadsheet has no worksheets".to_string())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| format!("worksheet read failed: {e}"))?;

    let (start_row, start_col) = range.start().unwrap_or((0, 0));
    let (end_row, end_col) = range.end().unwrap_or((0, 0));
    let row_end = end_row.min(start_row + SPREADSHEET_MAX_ROWS as u32 - 1);
    let col_end = end_col.min(start_col + SPREADSHEET_MAX_COLS as u32 - 1);
    let col_count = (col_end - start_col + 1) as usize;

    let mut rows = Vec::new();
    for row in start_row..=row_end {
        let mut cells = Vec::new();
        for col in start_col..=col_end {
            let value = range.get_value((row, col));
            cells.push(format_cell_value(value.cloned()));
        }
        while cells.len() < col_count {
            cells.push(String::new());
        }
        rows.push(cells);
    }
    Ok(rows)
}

// Human: Match explorer tile truncation rules for long cell values.
// Agent: READS calamine Data; RETURNS display string capped at CELL_TEXT_MAX_LEN.
fn format_cell_value(value: Option<Data>) -> String {
    let text = match value {
        Some(Data::String(s)) => s,
        Some(Data::Float(v)) => {
            if (v.fract()).abs() < f64::EPSILON {
                format!("{v:.0}")
            } else {
                v.to_string()
            }
        }
        Some(Data::Int(v)) => v.to_string(),
        Some(Data::Bool(v)) => v.to_string(),
        Some(Data::DateTime(v)) => v.to_string(),
        Some(Data::DateTimeIso(v)) => v,
        Some(Data::DurationIso(v)) => v,
        Some(Data::Error(e)) => format!("{e:?}"),
        Some(Data::Empty) | None => String::new(),
    };
    if text.chars().count() > CELL_TEXT_MAX_LEN {
        let truncated: String = text.chars().take(CELL_TEXT_MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        text
    }
}

fn fill_rect(image: &mut RgbImage, x0: u32, y0: u32, width: u32, height: u32, color: Rgb<u8>) {
    for y in y0..y0.saturating_add(height).min(image.height()) {
        for x in x0..x0.saturating_add(width).min(image.width()) {
            image.put_pixel(x, y, color);
        }
    }
}

fn stroke_rect(image: &mut RgbImage, x0: u32, y0: u32, width: u32, height: u32, color: Rgb<u8>) {
    let x1 = x0.saturating_add(width).min(image.width()).saturating_sub(1);
    let y1 = y0.saturating_add(height).min(image.height()).saturating_sub(1);
    for x in x0..=x1 {
        image.put_pixel(x, y0, color);
        image.put_pixel(x, y1, color);
    }
    for y in y0..=y1 {
        image.put_pixel(x0, y, color);
        image.put_pixel(x1, y, color);
    }
}

fn blit_text_bitmap(
    image: &mut RgbImage,
    x: i32,
    y: i32,
    bitmap: &[u8],
    width: usize,
    height: usize,
    color: Rgb<u8>,
) {
    for row in 0..height {
        for col in 0..width {
            let alpha = bitmap[row * width + col];
            if alpha == 0 {
                continue;
            }
            let px = x + col as i32;
            let py = y + row as i32;
            if px < 0 || py < 0 {
                continue;
            }
            let px = px as u32;
            let py = py as u32;
            if px >= image.width() || py >= image.height() {
                continue;
            }
            image.put_pixel(px, py, color);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spreadsheet_matrix_empty_workbook_errors() {
        let empty = b"not a workbook";
        assert!(spreadsheet_matrix_from_bytes(empty).is_err());
    }
}
