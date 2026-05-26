import Foundation

// Human: Upload batch types aligned with web `upload-manager` and `UploadProgressUpdate`.
// Agent: MATCHES phased progress uploading|processing|storing; USED UploadManager UploadTransferViews.

enum UploadPhase: String, Codable, Sendable {
    case uploading
    case processing
    case storing
}

enum UploadItemStatus: String, Codable, Sendable {
    case queued
    case uploading
    case done
    case error
    case cancelled
}

struct UploadItem: Identifiable, Sendable {
    let id: String
    var fileName: String
    var fileSize: Int64
    var mimeType: String
    var folderId: String?
    var status: UploadItemStatus
    var progress: Int
    var phase: UploadPhase
    var indeterminate: Bool
    var uploadedFileId: String?
    var error: String?
    /// Temp copy of the picked file — cleared after upload finishes or is cancelled.
    var localFileURL: URL?
}

struct UploadProgressUpdate: Sendable {
    let phase: UploadPhase
    let percent: Int
    let indeterminate: Bool
}

struct UploadFileResponse: Decodable, Sendable {
    let file: DriveFile
}

enum UploadServiceError: LocalizedError, Sendable {
    case noServerURL
    case unauthorized
    case cancelled
    case network(description: String)
    case server(message: String, code: String)

    var errorDescription: String? {
        switch self {
        case .noServerURL:
            "Server URL is not configured."
        case .unauthorized:
            "Session expired. Please sign in again."
        case .cancelled:
            "Upload cancelled"
        case .network(let description):
            description
        case .server(let message, _):
            message
        }
    }

    var code: String {
        switch self {
        case .cancelled:
            "upload_cancelled"
        case .server(_, let code):
            code
        case .unauthorized:
            "unauthorized"
        case .network:
            "network_error"
        case .noServerURL:
            "no_server_url"
        }
    }
}
