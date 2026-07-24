import Foundation

// Human: Persist in-flight resumable uploads so app kill does not lose server session_id + local temp file.
// Agent: UserDefaults JSON; RESTORED by UploadManager on bind; CLEARED when batch dismisses or rows finish.

enum UploadPersistence {
    private static let storageKey = "ownly.upload.batch.v1"

    struct PersistedItem: Codable, Sendable {
        var id: String
        var fileName: String
        var fileSize: Int64
        var mimeType: String
        var folderId: String?
        var status: String
        var progress: Int
        var phase: String
        var uploadedFileId: String?
        var error: String?
        var localFilePath: String?
        var resumableServerSessionId: String?
    }

    struct PersistedBatch: Codable, Sendable {
        var batchStatus: String
        var targetFolderId: String?
        var items: [PersistedItem]
    }

    static func save(batchStatus: String?, targetFolderId: String?, items: [UploadItem]) {
        guard let batchStatus else {
            UserDefaults.standard.removeObject(forKey: storageKey)
            return
        }

        // Human: Only keep rows that can still make progress after relaunch (queued/uploading/error with temp file).
        let keepable = items.compactMap { item -> PersistedItem? in
            let keepStatus = item.status == .queued
                || item.status == .uploading
                || (item.status == .error && item.localFileURL != nil)
            guard keepStatus else { return nil }
            return PersistedItem(
                id: item.id,
                fileName: item.fileName,
                fileSize: item.fileSize,
                mimeType: item.mimeType,
                folderId: item.folderId,
                status: item.status.rawValue,
                progress: item.progress,
                phase: item.phase.rawValue,
                uploadedFileId: item.uploadedFileId,
                error: item.error,
                localFilePath: item.localFileURL?.path,
                resumableServerSessionId: item.resumableServerSessionId
            )
        }

        if keepable.isEmpty {
            UserDefaults.standard.removeObject(forKey: storageKey)
            return
        }

        let batch = PersistedBatch(
            batchStatus: batchStatus,
            targetFolderId: targetFolderId,
            items: keepable
        )
        if let data = try? JSONEncoder().encode(batch) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    static func load() -> (batchStatus: String, targetFolderId: String?, items: [UploadItem])? {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let batch = try? JSONDecoder().decode(PersistedBatch.self, from: data)
        else {
            return nil
        }

        let items: [UploadItem] = batch.items.compactMap { row in
            let localURL = row.localFilePath.map { URL(fileURLWithPath: $0) }
            if let localURL, !FileManager.default.fileExists(atPath: localURL.path) {
                // Human: Temp copy gone after OS cleanup — cannot resume bytes without re-pick.
                if row.resumableServerSessionId != nil {
                    return UploadItem(
                        id: row.id,
                        fileName: row.fileName,
                        fileSize: row.fileSize,
                        mimeType: row.mimeType,
                        folderId: row.folderId,
                        status: .error,
                        progress: row.progress,
                        phase: UploadPhase(rawValue: row.phase) ?? .uploading,
                        indeterminate: false,
                        uploadedFileId: row.uploadedFileId,
                        error: "Re-select this file to continue the upload.",
                        localFileURL: nil,
                        resumableServerSessionId: row.resumableServerSessionId,
                        needsFileReselect: true
                    )
                }
                return nil
            }

            let status: UploadItemStatus
            if row.status == "uploading" || row.status == "queued" {
                // Human: After kill, re-queue so the pump restarts workers with server session resume.
                status = .queued
            } else {
                status = UploadItemStatus(rawValue: row.status) ?? .error
            }

            return UploadItem(
                id: row.id,
                fileName: row.fileName,
                fileSize: row.fileSize,
                mimeType: row.mimeType,
                folderId: row.folderId,
                status: status,
                progress: row.progress,
                phase: UploadPhase(rawValue: row.phase) ?? .uploading,
                indeterminate: false,
                uploadedFileId: row.uploadedFileId,
                error: row.error,
                localFileURL: localURL,
                resumableServerSessionId: row.resumableServerSessionId,
                needsFileReselect: false
            )
        }

        guard !items.isEmpty else {
            UserDefaults.standard.removeObject(forKey: storageKey)
            return nil
        }

        return (batch.batchStatus, batch.targetFolderId, items)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}
