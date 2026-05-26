import Foundation

// Human: Human-readable byte counts and dates for file explorer rows (mirrors web `formatBytes` / `formatFileOpened`).
// Agent: READS Int64/Date; RETURNS localized display strings for list and grid subtitles.
enum FileFormatting {
    static func formatBytes(_ bytes: Int64) -> String {
        guard bytes > 0 else { return "0 B" }
        let units = ["B", "KB", "MB", "GB", "TB"]
        let value = Double(bytes)
        var index = 0
        var scaled = value

        while scaled >= 1024, index < units.count - 1 {
            scaled /= 1024
            index += 1
        }

        if index == 0 || scaled >= 10 {
            return String(format: "%.0f %@", scaled, units[index])
        }
        return String(format: "%.1f %@", scaled, units[index])
    }

    static func formatOpened(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    static func formatRelative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// Human: Maps mime types to SF Symbol names and tint colors (Nextcloud-style type tiles).
// Agent: READS mimeType string; RETURNS icon + background tint for FileTypeIconView grid/list cells.
enum FileKind {
    case folder
    case image
    case video
    case audio
    case document
    case spreadsheet
    case presentation
    case generic

    init(mimeType: String?) {
        let mime = (mimeType ?? "").lowercased()
        if mime.hasPrefix("image/") {
            self = .image
        } else if mime.hasPrefix("video/") {
            self = .video
        } else if mime.hasPrefix("audio/") {
            self = .audio
        } else if mime.contains("spreadsheet") || mime.contains("excel") || mime == "text/csv" {
            self = .spreadsheet
        } else if mime.contains("presentation") || mime.contains("powerpoint") {
            self = .presentation
        } else if mime.hasPrefix("text/") || mime.contains("pdf") || mime.contains("document") || mime.contains("word") {
            self = .document
        } else {
            self = .generic
        }
    }

    var systemImage: String {
        switch self {
        case .folder: "folder.fill"
        case .image: "photo.fill"
        case .video: "film.fill"
        case .audio: "music.note"
        case .document: "doc.text.fill"
        case .spreadsheet: "tablecells.fill"
        case .presentation: "rectangle.on.rectangle.angled"
        case .generic: "doc.fill"
        }
    }
}

import SwiftUI

extension FileKind {
    var iconColor: Color {
        switch self {
        case .folder: DriveExplorerStyle.folderIcon
        case .image: DriveExplorerStyle.image
        case .video: DriveExplorerStyle.video
        case .audio: DriveExplorerStyle.audio
        case .document: DriveExplorerStyle.document
        case .spreadsheet: DriveExplorerStyle.spreadsheet
        case .presentation: DriveExplorerStyle.presentation
        case .generic: DriveExplorerStyle.generic
        }
    }

    var tileBackground: Color {
        switch self {
        case .folder:
            DriveExplorerStyle.folderFill
        default:
            iconColor.opacity(0.11)
        }
    }
}

// Human: Video ingest state helpers aligned with web `isFileProcessing`.
// Agent: READS DriveFile HLS fields; USED list/grid badges and disabled actions while processing.
enum FileProcessing {
    static func isProcessing(_ file: DriveFile) -> Bool {
        guard file.mimeType?.lowercased().hasPrefix("video/") == true, !file.hlsReady else {
            return false
        }
        let status = file.hlsEncodeStatus ?? ""
        return status != "failed" && status != "cancelled"
    }

    static func label(for file: DriveFile) -> String {
        if file.hlsEncodeStatus == "queued" {
            return "Processing"
        }
        if file.conversionProgress >= 50 {
            let storagePercent = min(99, Int(((Double(file.conversionProgress - 50) / 50) * 100).rounded()))
            return storagePercent > 0 ? "Moving to storage \(storagePercent)%" : "Moving to storage"
        }
        if file.conversionProgress > 0 {
            let encodePercent = min(99, Int((Double(file.conversionProgress) / 50 * 100).rounded()))
            return "Processing \(encodePercent)%"
        }
        return "Processing"
    }
}

func isImageMime(_ mimeType: String?) -> Bool {
    (mimeType ?? "").lowercased().hasPrefix("image/")
}
