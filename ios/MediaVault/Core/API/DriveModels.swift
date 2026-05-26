import Foundation

// Human: Codable shapes for MediaVault drive listing endpoints (`/files`, `/folders`).
// Agent: MATCHES backend JSON snake_case; USED DriveService DriveViewModel file explorer UI.

struct FolderCrumb: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct DriveFolder: Codable, Identifiable, Sendable, Hashable {
    let id: String
    let name: String
    let parentId: String?
    let createdAt: Date
    let updatedAt: Date
    let sharePublic: Bool

    enum CodingKeys: String, CodingKey {
        case id, name
        case parentId = "parent_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case sharePublic = "share_public"
    }
}

struct DriveFile: Codable, Identifiable, Sendable, Hashable {
    let id: String
    let name: String
    let mimeType: String?
    let sizeBytes: Int64
    let folderId: String?
    let createdAt: Date
    let updatedAt: Date
    let hlsReady: Bool
    let hlsEncodeStatus: String?
    let hlsEncodeError: String?
    let conversionProgress: Int
    let durationSeconds: Int?
    let sharePublic: Bool

    enum CodingKeys: String, CodingKey {
        case id, name
        case mimeType = "mime_type"
        case sizeBytes = "size_bytes"
        case folderId = "folder_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case hlsReady = "hls_ready"
        case hlsEncodeStatus = "hls_encode_status"
        case hlsEncodeError = "hls_encode_error"
        case conversionProgress = "conversion_progress"
        case durationSeconds = "duration_seconds"
        case sharePublic = "share_public"
    }
}

struct FolderListResponse: Decodable, Sendable {
    let folders: [DriveFolder]
    let folderCount: Int64
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case folders
        case folderCount = "folder_count"
        case hasMore = "has_more"
    }
}

struct VideoStreamURLResponse: Decodable, Sendable {
    let url: String?
    let hlsReady: Bool
    let conversionProgress: Int
    let hlsEncodeStatus: String?
    let hlsEncodeError: String?

    enum CodingKeys: String, CodingKey {
        case url
        case hlsReady = "hls_ready"
        case conversionProgress = "conversion_progress"
        case hlsEncodeStatus = "hls_encode_status"
        case hlsEncodeError = "hls_encode_error"
    }
}

struct FileListResponse: Decodable, Sendable {
    let files: [DriveFile]
    let totalBytes: Int64
    let fileCount: Int64
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case files
        case totalBytes = "total_bytes"
        case fileCount = "file_count"
        case hasMore = "has_more"
    }
}

enum DriveServiceError: LocalizedError, Equatable {
    case noServerURL
    case unauthorized
    case network(description: String)
    case server(message: String)

    var errorDescription: String? {
        switch self {
        case .noServerURL:
            "Server URL is not configured."
        case .unauthorized:
            "Session expired. Please sign in again."
        case .network(let description):
            description
        case .server(let message):
            message
        }
    }
}
