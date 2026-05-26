import Foundation

// Human: Persists a minimal snapshot of the drive root (names + item types only) for offline file explorer access.
// Agent: READS/WRITES UserDefaults per ServerConfig scope; TOP-LEVEL only; USED when ConnectivityMonitor reports offline.
struct CachedDriveEntry: Codable, Sendable, Equatable, Identifiable {
    enum ItemType: String, Codable, Sendable {
        case folder
        case file
    }

    let name: String
    let itemType: ItemType
    /// Mime type for files; nil for folders.
    let fileMimeType: String?

    var id: String {
        switch itemType {
        case .folder:
            "folder:\(name)"
        case .file:
            "file:\(name):\(fileMimeType ?? "")"
        }
    }

    init(name: String, itemType: ItemType, fileMimeType: String? = nil) {
        self.name = name
        self.itemType = itemType
        self.fileMimeType = fileMimeType
    }

    init(folder: DriveFolder) {
        name = folder.name
        itemType = .folder
        fileMimeType = nil
    }

    init(file: DriveFile) {
        name = file.name
        itemType = .file
        fileMimeType = file.mimeType
    }
}

enum DriveTopLevelCache {
    private static let keyPrefix = "mediavault.drive.topLevelCache.v1"

    static func load(for config: ServerConfig) -> [CachedDriveEntry] {
        guard let raw = UserDefaults.standard.string(forKey: storageKey(for: config)),
              let data = raw.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([CachedDriveEntry].self, from: data) else {
            return []
        }
        return decoded
    }

    static func save(_ entries: [CachedDriveEntry], for config: ServerConfig) {
        guard let data = try? JSONEncoder().encode(entries),
              let raw = String(data: data, encoding: .utf8) else {
            return
        }
        UserDefaults.standard.set(raw, forKey: storageKey(for: config))
    }

    static func clear(for config: ServerConfig) {
        UserDefaults.standard.removeObject(forKey: storageKey(for: config))
    }

    private static func storageKey(for config: ServerConfig) -> String {
        "\(keyPrefix).\(config.cacheScopeKey)"
    }
}

extension ServerConfig {
    /// Scopes offline cache entries to a specific MediaVault host/port/scheme.
    var cacheScopeKey: String {
        let normalizedHost = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return "\(useHTTPS ? "https" : "http")://\(normalizedHost):\(port)"
    }
}

extension CachedDriveEntry {
    func asDriveFolder() -> DriveFolder {
        DriveFolder.offlinePlaceholder(id: id, name: name)
    }

    func asDriveFile() -> DriveFile {
        DriveFile.offlinePlaceholder(id: id, name: name, mimeType: fileMimeType)
    }
}

extension DriveFolder {
    static func offlinePlaceholder(id: String, name: String) -> DriveFolder {
        DriveFolder(
            id: id,
            name: name,
            parentId: nil,
            createdAt: .distantPast,
            updatedAt: .distantPast,
            sharePublic: false
        )
    }
}

extension DriveFile {
    static func offlinePlaceholder(id: String, name: String, mimeType: String?) -> DriveFile {
        DriveFile(
            id: id,
            name: name,
            mimeType: mimeType,
            sizeBytes: 0,
            folderId: nil,
            createdAt: .distantPast,
            updatedAt: .distantPast,
            hlsReady: false,
            hlsEncodeStatus: nil,
            hlsEncodeError: nil,
            conversionProgress: 0,
            durationSeconds: nil,
            sharePublic: false
        )
    }
}
