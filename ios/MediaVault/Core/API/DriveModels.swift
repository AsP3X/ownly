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

    // Human: Memberwise initializer for offline cache placeholders and tests.
    // Agent: SETS defaults for optional encode/HLS fields; USED DriveTopLevelCache offline rows.
    init(
        id: String,
        name: String,
        mimeType: String?,
        sizeBytes: Int64,
        folderId: String?,
        createdAt: Date,
        updatedAt: Date,
        hlsReady: Bool,
        hlsEncodeStatus: String?,
        hlsEncodeError: String?,
        conversionProgress: Int,
        durationSeconds: Int?,
        sharePublic: Bool
    ) {
        self.id = id
        self.name = name
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.folderId = folderId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.hlsReady = hlsReady
        self.hlsEncodeStatus = hlsEncodeStatus
        self.hlsEncodeError = hlsEncodeError
        self.conversionProgress = conversionProgress
        self.durationSeconds = durationSeconds
        self.sharePublic = sharePublic
    }

    // Human: Upload and GET /files/:id return `FileDto` without `share_public`; list rows include it.
    // Agent: DECODES share_public when present; DEFAULT false for upload/get payloads.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(String.self, forKey: .id),
            name: try container.decode(String.self, forKey: .name),
            mimeType: try container.decodeIfPresent(String.self, forKey: .mimeType),
            sizeBytes: try container.decode(Int64.self, forKey: .sizeBytes),
            folderId: try container.decodeIfPresent(String.self, forKey: .folderId),
            createdAt: try container.decode(Date.self, forKey: .createdAt),
            updatedAt: try container.decode(Date.self, forKey: .updatedAt),
            hlsReady: try container.decode(Bool.self, forKey: .hlsReady),
            hlsEncodeStatus: try container.decodeIfPresent(String.self, forKey: .hlsEncodeStatus),
            hlsEncodeError: try container.decodeIfPresent(String.self, forKey: .hlsEncodeError),
            conversionProgress: try container.decodeIfPresent(Int.self, forKey: .conversionProgress) ?? 0,
            durationSeconds: try container.decodeIfPresent(Int.self, forKey: .durationSeconds),
            sharePublic: try container.decodeIfPresent(Bool.self, forKey: .sharePublic) ?? false
        )
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

/// Poll response for `GET`/`POST` `/files/:id/export` (HLS → MP4 remux before download).
struct FileDownloadURLResponse: Decodable, Sendable {
    let url: String
    let expiresInSeconds: Int

    enum CodingKeys: String, CodingKey {
        case url
        case expiresInSeconds = "expires_in_seconds"
    }
}

struct VideoExportStatus: Decodable, Sendable {
    let status: String
    let progress: Int
    let ready: Bool
    let sizeBytes: Int64?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case status, progress, ready, error
        case sizeBytes = "size_bytes"
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

struct ShareLink: Codable, Identifiable, Sendable, Hashable {
    let id: String
    let token: String
    let resourceType: String
    let resourceId: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, token
        case resourceType = "resource_type"
        case resourceId = "resource_id"
        case createdAt = "created_at"
    }
}

struct ShareLookupResponse: Decodable, Sendable {
    let share: ShareLink?
}

struct ShareCreateResponse: Decodable, Sendable {
    let share: ShareLink
}

struct ResourceSharesResponse: Decodable, Sendable {
    let publicShare: ShareLink?

    enum CodingKeys: String, CodingKey {
        case publicShare = "public_share"
    }
}

struct FolderDownloadStatus: Decodable, Sendable {
    let status: String
    let progress: Int
    let ready: Bool
    let archiveName: String
    let sizeBytes: Int64?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case status, progress, ready, error
        case archiveName = "archive_name"
        case sizeBytes = "size_bytes"
    }
}

enum DriveServiceError: LocalizedError, Equatable {
    case noServerURL
    case unauthorized
    case network(description: String)
    case server(message: String)
    /// Pull-to-refresh or a superseded load cancelled in-flight requests — not user-facing.
    case cancelled

    /// True when the failure is task/URL cancellation, not a server or config problem.
    var isCancellation: Bool {
        if case .cancelled = self { return true }
        return false
    }

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
        case .cancelled:
            nil
        }
    }
}
