// Human: MIME and filename rules for document grid preview generation.
// Agent: MATCHES frontend isPdfMime / isSpreadsheetPreviewMime for upload enqueue + GET guard.

// Human: True when the file should open in the PDF viewer dialog.
// Agent: READS mime_type; RETURNS true for application/pdf and other */pdf buckets.
pub fn is_pdf_mime(mime_type: &str) -> bool {
    let mime = mime_type.to_ascii_lowercase();
    mime == "application/pdf" || mime.ends_with("/pdf")
}

const SPREADSHEET_EXTENSIONS: &[&str] = &["xlsx", "xls", "xlsm", "xlsb", "ods"];

// Human: True when the file should open in the spreadsheet preview dialog (not plain CSV).
// Agent: READS mime_type + filename extension; MATCHES frontend isSpreadsheetPreviewMime.
pub fn is_spreadsheet_preview_mime(mime_type: &str, filename: &str) -> bool {
    let mime = mime_type.to_ascii_lowercase();
    let extension = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    if extension == "csv" {
        return false;
    }
    if SPREADSHEET_EXTENSIONS.contains(&extension.as_str()) {
        return true;
    }
    if mime.contains("csv") {
        return false;
    }

    mime.contains("spreadsheet")
        || mime.contains("excel")
        || (mime.contains("sheet") && !mime.contains("word"))
}

// Human: True when upload should enqueue a document grid JPEG sidecar job.
// Agent: OR of PDF and spreadsheet preview matchers.
pub fn qualifies_for_document_grid_thumbnail(mime_type: &str, filename: &str) -> bool {
    is_pdf_mime(mime_type) || is_spreadsheet_preview_mime(mime_type, filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_mime_detection() {
        assert!(is_pdf_mime("application/pdf"));
        assert!(!is_pdf_mime("application/vnd.ms-excel"));
    }

    #[test]
    fn spreadsheet_detection_skips_csv() {
        assert!(!is_spreadsheet_preview_mime("text/csv", "data.csv"));
        assert!(is_spreadsheet_preview_mime(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "report.xlsx",
        ));
    }
}
