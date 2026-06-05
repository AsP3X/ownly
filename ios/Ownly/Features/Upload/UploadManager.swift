import Foundation
import Observation

// Human: In-memory upload batch queue — parallel uploads with phased progress like the web transfer panel.
// Agent: CALLS UploadService; WRITES UploadItem rows; PUMPS max 3 concurrent; NOTIFY onFileUploaded when a row completes.
@Observable
@MainActor
final class UploadManager {
    static let maxConcurrent = UploadService.maxConcurrentUploads

    private(set) var items: [UploadItem] = []
    private(set) var batchStatus: UploadBatchStatus?
    var targetFolderId: String?

    /// Fired when a file row reaches `done` so the drive list can refresh.
    var onFileUploaded: (() -> Void)?

    var hasBatch: Bool { batchStatus != nil }

    var isUploading: Bool { batchStatus == .uploading }

    var overallPercent: Int {
        guard !items.isEmpty else { return 0 }
        let processed = items.filter { $0.status == .done || $0.status == .error || $0.status == .cancelled }.count
        return Int((Double(processed) / Double(items.count) * 100).rounded())
    }

    var activeUploadCount: Int {
        items.filter { $0.status == .uploading }.count
    }

    var queuedCount: Int {
        items.filter { $0.status == .queued }.count
    }

    private var config: ServerConfig?
    private var runningWorkers = 0

    enum UploadBatchStatus: String, Sendable {
        case uploading
        case complete
    }

    func bind(config: ServerConfig) {
        self.config = config
    }

    // MARK: - Batch control

    func startBatch(fileURLs: [URL], folderId: String?) {
        guard !fileURLs.isEmpty else { return }

        let prepared = fileURLs.compactMap { preparePickedFile($0, folderId: folderId) }
        guard !prepared.isEmpty else { return }

        if batchStatus == .uploading {
            items.append(contentsOf: prepared)
        } else {
            batchStatus = .uploading
            items = prepared
        }

        pumpQueue()
    }

    func dismissBatch() {
        guard batchStatus == .complete else { return }
        items = []
        batchStatus = nil
    }

    func cancelItem(id: String) {
        guard batchStatus == .uploading else { return }
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }

        let item = items[index]

        if item.status == .queued {
            items[index].status = .cancelled
            items[index].error = "Cancelled"
            maybeCompleteBatch()
            pumpQueue()
            return
        }

        if item.status == .uploading {
            if let fileId = item.uploadedFileId, item.mimeType.lowercased().hasPrefix("video/"), let config {
                Task {
                    await UploadService.cancelVideoIngest(config: config, fileId: fileId)
                    await UploadService.deleteFile(config: config, fileId: fileId)
                }
            }
            if item.localFileURL != nil, let config {
                UploadService.abortUploadSession(config: config, sessionId: id)
            } else {
                items[index].status = .cancelled
                items[index].error = "Cancelled"
                maybeCompleteBatch()
            }
            cleanupLocalFile(at: index)
        }
    }

    func cancelAll() {
        guard batchStatus == .uploading else { return }
        let pending = items.filter { $0.status == .queued || $0.status == .uploading }.map(\.id)
        for id in pending {
            cancelItem(id: id)
        }
    }

    func removeItem(id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        let item = items[index]
        guard item.status == .error || item.status == .cancelled else { return }

        if let fileId = item.uploadedFileId, let config {
            Task { await UploadService.deleteFile(config: config, fileId: fileId) }
        }

        cleanupLocalFile(at: index)
        items.remove(at: index)

        if items.isEmpty {
            batchStatus = nil
        } else if batchStatus == .uploading {
            maybeCompleteBatch()
        }
    }

    // MARK: - Queue pump

    private func pumpQueue() {
        guard batchStatus == .uploading, let config else { return }

        while runningWorkers < Self.maxConcurrent, let nextIndex = items.firstIndex(where: { $0.status == .queued }) {
            items[nextIndex].status = .uploading
            items[nextIndex].progress = 0
            items[nextIndex].phase = .uploading
            runningWorkers += 1
            let item = items[nextIndex]
            Task {
                await uploadItem(item, config: config)
            }
        }
    }

    private func uploadItem(_ item: UploadItem, config: ServerConfig) async {
        let uploadId = item.id
        defer {
            runningWorkers = max(0, runningWorkers - 1)
            pumpQueue()
        }

        guard let fileURL = item.localFileURL else {
            markError(uploadId: uploadId, message: "Upload file is missing.")
            return
        }

        do {
            let file = try await UploadService.uploadFile(
                config: config,
                fileURL: fileURL,
                fileName: item.fileName,
                mimeType: item.mimeType,
                folderId: item.folderId ?? targetFolderId,
                sessionId: uploadId,
                onProgress: { [weak self] update in
                    Task { @MainActor in
                        self?.applyProgress(uploadId: uploadId, update: update)
                    }
                },
                onServerFileRegistered: { [weak self] registered in
                    Task { @MainActor in
                        self?.registerServerFile(uploadId: uploadId, file: registered)
                    }
                }
            )

            markDone(uploadId: uploadId, file: file)
            onFileUploaded?()
        } catch let error as UploadServiceError {
            if error.code == "upload_cancelled" {
                markCancelled(uploadId: uploadId)
            } else {
                markError(uploadId: uploadId, message: error.localizedDescription ?? "Upload failed.")
            }
        } catch {
            markError(uploadId: uploadId, message: error.localizedDescription)
        }
    }

    private func applyProgress(uploadId: String, update: UploadProgressUpdate) {
        guard let index = items.firstIndex(where: { $0.id == uploadId }) else { return }
        let current = items[index].phase
        // Human: Each phase replaces the prior bar — never regress from processing/storing to uploading.
        // Agent: IGNORES stale byte callbacks after post-upload phases begin.
        if Self.phaseRank(update.phase) < Self.phaseRank(current) {
            return
        }
        if current != .uploading, update.phase == .uploading {
            return
        }
        items[index].progress = update.percent
        items[index].phase = update.phase
        items[index].indeterminate = update.indeterminate
    }

    private static func phaseRank(_ phase: UploadPhase) -> Int {
        switch phase {
        case .uploading: 0
        case .processing: 1
        case .storing: 2
        }
    }

    private func registerServerFile(uploadId: String, file: DriveFile) {
        guard let index = items.firstIndex(where: { $0.id == uploadId }) else { return }
        items[index].uploadedFileId = file.id
        items[index].fileName = file.name
        items[index].fileSize = file.sizeBytes
        items[index].mimeType = file.mimeType ?? items[index].mimeType

        if UploadService.isVideoAwaitingIngest(file) {
            items[index].phase = .processing
            items[index].progress = 0
            items[index].indeterminate = false
        }
    }

    private func markDone(uploadId: String, file: DriveFile) {
        guard let index = items.firstIndex(where: { $0.id == uploadId }) else { return }
        items[index].status = .done
        items[index].progress = 100
        items[index].phase = .storing
        items[index].uploadedFileId = file.id
        items[index].indeterminate = false
        cleanupLocalFile(at: index)
        maybeCompleteBatch()
    }

    private func markError(uploadId: String, message: String) {
        guard let index = items.firstIndex(where: { $0.id == uploadId }) else { return }
        items[index].status = .error
        items[index].error = message
        cleanupLocalFile(at: index)
        maybeCompleteBatch()
    }

    private func markCancelled(uploadId: String) {
        guard let index = items.firstIndex(where: { $0.id == uploadId }) else { return }
        items[index].status = .cancelled
        items[index].error = "Cancelled"
        cleanupLocalFile(at: index)
        maybeCompleteBatch()
    }

    private func maybeCompleteBatch() {
        guard batchStatus == .uploading else { return }
        let terminal: Set<UploadItemStatus> = [.done, .error, .cancelled]
        if items.allSatisfy({ terminal.contains($0.status) }) {
            batchStatus = .complete
        }
    }

    private func preparePickedFile(_ url: URL, folderId: String?) -> UploadItem? {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }

        let fileName = UploadService.displayFileName(for: url)
        let mimeType = UploadService.mimeType(for: url)

        let size: Int64
        if let values = try? url.resourceValues(forKeys: [.fileSizeKey]), let bytes = values.fileSize {
            size = Int64(bytes)
        } else {
            size = 0
        }

        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("Ownly-uploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let dest = tempDir.appendingPathComponent("\(UUID().uuidString)-\(fileName)")

        do {
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.copyItem(at: url, to: dest)
        } catch {
            return nil
        }

        return UploadItem(
            id: UUID().uuidString,
            fileName: fileName,
            fileSize: size,
            mimeType: mimeType,
            folderId: folderId,
            status: .queued,
            progress: 0,
            phase: .uploading,
            indeterminate: false,
            uploadedFileId: nil,
            error: nil,
            localFileURL: dest
        )
    }

    private func cleanupLocalFile(at index: Int) {
        if let url = items[index].localFileURL {
            try? FileManager.default.removeItem(at: url)
            items[index].localFileURL = nil
        }
    }
}
