// Human: Spreadsheet grid preview JPEG — matches the in-app explorer tile layout, not print export.
// Agent: READS first worksheet via calamine; RENDERS green chrome + cell grid; RETURNS JPEG bytes.

use calamine::{open_workbook_auto, Data, Reader};
use fontdue::Font;
use image::{ImageBuffer, Rgb, RgbImage};

use crate::image::thumbnail::encode_jpeg;

/// Human: Square canvas size for stored spreadsheet preview JPEG sidecars.
const PREVIEW_SIZE: u32 = 1200;

const PREVIEW_ROWS: usize = 7;
const PREVIEW_COLS: usize = 5;
const CELL_TEXT_MAX_LEN: usize = 10;

const EXCEL_GREEN: Rgb<u8> = Rgb([16, 124, 65]);
const BORDER_GRAY: Rgb<u8> = Rgb([229, 231, 235]);
const HEADER_BG: Rgb<u8> = Rgb([250, 250, 250]);
const HEADER_TEXT: Rgb<u8> = Rgb([102, 102, 102]);
const BODY_TEXT: Rgb<u8> = Rgb([26, 26, 26]);
const WHITE: Rgb<u8> = Rgb([255, 255, 255]);

// Human: Chrome + padding scaled from the 168px explorer tile to the stored preview canvas.
const HEADER_BAR_PX: u32 = 11;
const GRID_PADDING_PX: u32 = 7;
const SPREADSHEET_JPEG_QUALITY: u8 = 90;

// Human: Build a square grid preview JPEG from workbook bytes — same cell window as the web tile.
// Agent: CALLED by document thumbnail worker; MATCHES ExplorerSpreadsheetThumbnail rows/cols/styling.
pub fn generate_spreadsheet_preview_jpeg(source_bytes: &[u8], filename: &str) -> Result<Vec<u8>, String> {
    let matrix = spreadsheet_matrix_from_bytes(source_bytes, filename)?;
    if matrix.is_empty() {
        return Err("spreadsheet has no previewable cells".into());
    }
    render_spreadsheet_grid_jpeg(&matrix)
}

// Human: Read the first worksheet into a truncated string matrix for the tile preview.
// Agent: TRUNCATES long values; PADS short rows to a uniform column count.
fn spreadsheet_matrix_from_bytes(source_bytes: &[u8], filename: &str) -> Result<Vec<Vec<String>>, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("temp dir failed: {e}"))?;
    let extension = spreadsheet_extension(filename);
    let path = temp_dir.path().join(format!("source.{extension}"));
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
    let row_end = end_row.min(start_row + PREVIEW_ROWS as u32 - 1);
    let col_end = end_col.min(start_col + PREVIEW_COLS as u32 - 1);
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

// Human: Map filename extension for calamine ingest (xlsx, xls, ods, xlsm, xlsb).
fn spreadsheet_extension(filename: &str) -> &'static str {
    match filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "xls" => "xls",
        "xlsm" => "xlsm",
        "xlsb" => "xlsb",
        "ods" => "ods",
        _ => "xlsx",
    }
}

// Human: Match explorer tile truncation rules for long cell values.
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

// Human: Paint the mini worksheet grid onto a square JPEG matching the drive explorer tile.
// Agent: FILLS canvas edge-to-edge; USES DejaVu/Arial when available for readable cell labels.
fn render_spreadsheet_grid_jpeg(matrix: &[Vec<String>]) -> Result<Vec<u8>, String> {
    let cols = matrix
        .iter()
        .map(|row| row.len())
        .max()
        .unwrap_or(PREVIEW_COLS)
        .max(1);
    let rows = matrix.len().max(1);

    let mut image: RgbImage = ImageBuffer::from_pixel(PREVIEW_SIZE, PREVIEW_SIZE, WHITE);

    for x in 0..PREVIEW_SIZE {
        for y in 0..HEADER_BAR_PX {
            image.put_pixel(x, y, EXCEL_GREEN);
        }
    }

    let grid_top = HEADER_BAR_PX + GRID_PADDING_PX;
    let grid_left = GRID_PADDING_PX;
    let grid_width = PREVIEW_SIZE.saturating_sub(GRID_PADDING_PX * 2);
    let grid_height = PREVIEW_SIZE.saturating_sub(grid_top + GRID_PADDING_PX);
    let cell_width = (grid_width / cols as u32).max(1);
    let cell_height = (grid_height / rows as u32).max(1);

    let font = load_preview_font();
    let font_size = (cell_height.saturating_sub(8).max(16) as f32 * 0.42).min(52.0);
    let text_pad_x = 4i32;
    let text_pad_y = 4i32;

    for (row_index, row) in matrix.iter().enumerate() {
        for (col_index, cell) in row.iter().enumerate() {
            let x0 = grid_left + col_index as u32 * cell_width;
            let y0 = grid_top + row_index as u32 * cell_height;
            let bg = if row_index == 0 { HEADER_BG } else { WHITE };
            fill_rect(&mut image, x0, y0, cell_width, cell_height, bg);
            stroke_rect(&mut image, x0, y0, cell_width, cell_height, BORDER_GRAY);

            if let Some(font) = &font {
                let color = if row_index == 0 {
                    HEADER_TEXT
                } else {
                    BODY_TEXT
                };
                let mut cursor_x = x0 as i32 + text_pad_x;
                let max_x = x0 as i32 + cell_width as i32 - text_pad_x;
                for ch in cell.chars().take(CELL_TEXT_MAX_LEN + 1) {
                    if cursor_x >= max_x {
                        break;
                    }
                    let (metrics, bitmap) = font.rasterize(ch, font_size);
                    blit_text_bitmap(
                        &mut image,
                        cursor_x,
                        y0 as i32 + text_pad_y,
                        &bitmap,
                        metrics.width,
                        metrics.height,
                        color,
                    );
                    cursor_x += metrics.advance_width as i32;
                }
            }
        }
    }

    let dynamic = image::DynamicImage::ImageRgb8(image);
    encode_jpeg(&dynamic, SPREADSHEET_JPEG_QUALITY)
}

// Human: Pick a readable sans font from common OS paths for spreadsheet cell labels.
fn load_preview_font() -> Option<Font> {
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
        assert!(spreadsheet_matrix_from_bytes(empty, "report.xlsx").is_err());
    }
}
