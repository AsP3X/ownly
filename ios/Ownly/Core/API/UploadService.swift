import Foundation
import UniformTypeIdentifiers

// Human: Multipart upload and post-upload ingest polling for the iOS drive client.
// Agent: POST /files/upload with byte progress; GET /files/:id for HLS phases; DELETE + cancel-ingest on abort.
enum UploadService {
    static let maxConcurrentUploads = 3
    /// Human: Non-video files switch to chunked upload above this size — matches web RESUMABLE_UPLOAD_THRESHOLD_BYTES.
    static let resumableUploadThresholdBytes: Int64 = 32 * 1024 * 1024
    /// Human: Video files use chunked upload above this lower threshold — matches web RESUMABLE_VIDEO_THRESHOLD_BYTES.
    static let resumableVideoThresholdBytes: Int64 = 8 * 1024 * 1024
    static let uploadChunkSizeBytes: Int64 = 16 * 1024 * 1024
    static let resumablePartConcurrency = 2
    private static let processingAsymptote = 99.4
    private static let processingDisplayMax = 99
    private static let processingIndeterminateMs = 2_500
    private static let hlsStorageProgressStart = 50
    private static let videoIngestPollMs: UInt64 = 1_500_000_000

    private static let coordinator = UploadSessionCoordinator()

    // MARK: - Public API

    /// Human: Route large or video uploads through the resumable session API instead of one-shot multipart POST.
    /// Agent: READS mime + file size; RETURNS true below 32 MiB for video/* only.
    static func shouldUseResumableUpload(fileSize: Int64, mimeType: String) -> Bool {
        if mimeType.lowercased().hasPrefix("video/") {
            return fileSize > resumableVideoThresholdBytes
        }
        return fileSize > resumableUploadThresholdBytes
    }

    static func uploadFile(
        config: ServerConfig,
        fileURL: URL,
        fileName: String,
        mimeType: String,
        folderId: String?,
        sessionId: String,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void,
        onServerFileRegistered: @escaping @Sendable (DriveFile) -> Void
    ) async throws -> DriveFile {
        let isVideo = mimeType.lowercased().hasPrefix("video/")

        onProgress(UploadProgressUpdate(phase: .uploading, percent: 0, indeterminate: false))

        let postUploadPhase = UploadPostUploadPhaseGate()
        let processingSimulation = UploadProcessingSimulationSlot()
        let progressRelay = UploadProgressRelay(
            isVideo: isVideo,
            sessionId: sessionId,
            postUploadPhase: postUploadPhase,
            processingSimulation: processingSimulation,
            onProgress: onProgress
        )
        let emitProgress = progressRelay.emit

        let file = try await coordinator.upload(
            config: config,
            fileURL: fileURL,
            fileName: fileName,
            mimeType: mimeType,
            folderId: folderId,
            sessionId: sessionId,
            isVideo: isVideo,
            onProgress: emitProgress,
            existingResumableSessionId: nil
        )

        processingSimulation.cancel()

        onServerFileRegistered(file)

        if isVideoAwaitingIngest(file) {
            postUploadPhase.lockToPostUpload()
            return try await waitForFileIngestCompletion(
                config: config,
                fileId: file.id,
                sessionId: sessionId,
                onProgress: { update in
                    guard postUploadPhase.shouldEmit(update, isVideo: true) else { return }
                    onProgress(update)
                }
            )
        }

        onProgress(UploadProgressUpdate(phase: .processing, percent: 100, indeterminate: false))
        return file
    }

    static func fetchFile(config: ServerConfig, fileId: String) async throws -> DriveFile {
        let response: UploadFileResponse = try await authorizedGET(config: config, path: "/files/\(fileId)")
        return response.file
    }

    static func deleteFile(config: ServerConfig, fileId: String) async {
        guard var request = try? authorizedRequest(config: config, path: "/files/\(fileId)", method: "DELETE") else {
            return
        }
        request.httpBody = nil
        _ = try? await URLSession.shared.data(for: request)
    }

    static func cancelVideoIngest(config: ServerConfig, fileId: String) async {
        guard var request = try? authorizedRequest(
            config: config,
            path: "/files/\(fileId)/cancel-ingest",
            method: "POST"
        ) else { return }
        request.httpBody = Data()
        _ = try? await URLSession.shared.data(for: request)
    }

    static func abortUploadSession(config: ServerConfig, sessionId: String) {
        Task {
            await coordinator.abort(config: config, sessionId: sessionId)
        }
    }

    /// Human: Abort a partial resumable server session and discard spooled parts on the API host.
    /// Agent: DELETE /uploads/{id}; BEST-EFFORT when the user cancels a chunked upload.
    static func abortResumableUploadSession(config: ServerConfig, sessionId: String) async {
        guard var request = try? authorizedRequest(config: config, path: "/uploads/\(sessionId)", method: "DELETE") else {
            return
        }
        request.httpBody = nil
        _ = try? await URLSession.shared.data(for: request)
    }

    // MARK: - Ingest polling

    private static func waitForFileIngestCompletion(
        config: ServerConfig,
        fileId: String,
        sessionId: String,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void
    ) async throws -> DriveFile {
        while true {
            if await coordinator.isCancelled(sessionId: sessionId) {
                throw UploadServiceError.cancelled
            }

            let file = try await fetchFile(config: config, fileId: fileId)

            if await coordinator.isCancelled(sessionId: sessionId) {
                throw UploadServiceError.cancelled
            }

            if file.hlsEncodeStatus == "failed" {
                throw UploadServiceError.server(
                    message: file.hlsEncodeError ?? "Video processing failed",
                    code: "video_ingest_failed"
                )
            }

            if file.hlsEncodeStatus == "cancelled" {
                throw UploadServiceError.cancelled
            }

            onProgress(mapVideoIngestProgress(file))

            if file.hlsReady {
                return file
            }

            try await Task.sleep(nanoseconds: videoIngestPollMs)
        }
    }

    static func mapVideoIngestProgress(_ file: DriveFile) -> UploadProgressUpdate {
        if file.hlsReady {
            return UploadProgressUpdate(phase: .storing, percent: 100, indeterminate: false)
        }

        if file.hlsEncodeStatus == "queued" {
            return UploadProgressUpdate(phase: .processing, percent: 0, indeterminate: true)
        }

        let raw = file.conversionProgress
        if raw >= hlsStorageProgressStart {
            let percent = min(
                processingDisplayMax,
                Int(((Double(raw - hlsStorageProgressStart) / Double(hlsStorageProgressStart)) * 100).rounded())
            )
            return UploadProgressUpdate(phase: .storing, percent: percent, indeterminate: false)
        }

        let percent = min(
            processingDisplayMax,
            Int((Double(raw) / Double(hlsStorageProgressStart) * 100).rounded())
        )
        return UploadProgressUpdate(phase: .processing, percent: percent, indeterminate: false)
    }

    static func isVideoAwaitingIngest(_ file: DriveFile) -> Bool {
        (file.mimeType ?? "").lowercased().hasPrefix("video/") && !file.hlsReady
    }

    // Human: Ease a non-video bar toward ~99% while the API finishes storing the blob.
    // Agent: TIMER asymptotic steps; indeterminate after delay — mirrors web `startProcessingPhase`.
    static func runNonVideoProcessingSimulation(
        sessionId: String,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void
    ) async {
        var processingPercent = 0.0
        let started = Date()
        while !Task.isCancelled {
            if await coordinator.isCancelled(sessionId: sessionId) { return }
            let elapsed = Date().timeIntervalSince(started) * 1000
            let display = min(
                processingDisplayMax,
                max(0, Int(processingPercent.rounded(.down)))
            )
            let indeterminate = elapsed >= Double(processingIndeterminateMs)
                || display >= processingDisplayMax
            onProgress(UploadProgressUpdate(phase: .processing, percent: display, indeterminate: indeterminate))
            processingPercent += (processingAsymptote - processingPercent) * 0.14
            try? await Task.sleep(nanoseconds: 380_000_000)
        }
    }

    // MARK: - MIME / multipart helpers

    static func mimeType(for url: URL) -> String {
        let ext = url.pathExtension
        if let type = UTType(filenameExtension: ext), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }

    static func displayFileName(for url: URL) -> String {
        let name = url.lastPathComponent
        return name.isEmpty ? "upload" : name
    }

    // MARK: - HTTP helpers

    private static func authorizedGET<T: Decodable>(
        config: ServerConfig,
        path: String
    ) async throws -> T {
        guard let request = try? authorizedRequest(config: config, path: path, method: "GET") else {
            throw UploadServiceError.noServerURL
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private static func authorizedRequest(
        config: ServerConfig,
        path: String,
        method: String
    ) throws -> URLRequest {
        guard let url = config.requestURL(path: path) else {
            throw UploadServiceError.noServerURL
        }
        guard let token = AuthTokenStorage.getToken(), !token.isEmpty else {
            throw UploadServiceError.unauthorized
        }

        var request = URLRequest(url: url, timeoutInterval: 600)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        AppIdentity.apply(to: &request)
        return request
    }

    private static func decodeResponse<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else {
            throw UploadServiceError.network(description: "Invalid response.")
        }
        if http.statusCode == 401 {
            throw UploadServiceError.unauthorized
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            let message = parseErrorMessage(from: data) ?? "Request failed."
            let code = parseErrorCode(from: data) ?? "request_failed"
            throw UploadServiceError.server(message: message, code: code)
        }
        return try OwnlyJSON.makeDecoder().decode(T.self, from: data)
    }

    private static func parseErrorMessage(from data: Data) -> String? {
        guard let body = try? JSONDecoder().decode(APIErrorBody.self, from: data) else { return nil }
        return body.error.message
    }

    private static func parseErrorCode(from data: Data) -> String? {
        guard let body = try? JSONDecoder().decode(APIErrorBody.self, from: data) else { return nil }
        return body.error.code
    }
}

// Human: Ensures upload byte callbacks cannot overwrite processing/storing UI after a phase advance.
// Agent: USED uploadFile wrapped onProgress; LOCKS after video bytes complete or server file registered.
private final class UploadProgressRelay: @unchecked Sendable {
    let isVideo: Bool
    let sessionId: String
    let postUploadPhase: UploadPostUploadPhaseGate
    let processingSimulation: UploadProcessingSimulationSlot
    let onProgress: @Sendable (UploadProgressUpdate) -> Void

    init(
        isVideo: Bool,
        sessionId: String,
        postUploadPhase: UploadPostUploadPhaseGate,
        processingSimulation: UploadProcessingSimulationSlot,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void
    ) {
        self.isVideo = isVideo
        self.sessionId = sessionId
        self.postUploadPhase = postUploadPhase
        self.processingSimulation = processingSimulation
        self.onProgress = onProgress
    }

    func emit(_ update: UploadProgressUpdate) {
        guard postUploadPhase.shouldEmit(update, isVideo: isVideo) else { return }
        onProgress(update)

        if !isVideo, update.phase == .uploading, update.percent >= 100 {
            processingSimulation.startIfNeeded(sessionId: sessionId) { [weak self] update in
                self?.emit(update)
            }
        }
    }
}

private final class UploadProcessingSimulationSlot: @unchecked Sendable {
    private let lock = NSLock()
    private var task: Task<Void, Never>?

    func startIfNeeded(
        sessionId: String,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard task == nil else { return }
        task = Task {
            await UploadService.runNonVideoProcessingSimulation(sessionId: sessionId, onProgress: onProgress)
        }
    }

    func cancel() {
        lock.lock()
        task?.cancel()
        task = nil
        lock.unlock()
    }
}

private final class UploadPostUploadPhaseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var postUpload = false

    func shouldEmit(_ update: UploadProgressUpdate, isVideo: Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if postUpload, update.phase == .uploading {
            return false
        }
        if isVideo, update.phase == .processing || update.phase == .storing {
            postUpload = true
        }
        if update.phase == .processing || update.phase == .storing {
            postUpload = true
        }
        return true
    }

    func lockToPostUpload() {
        lock.lock()
        postUpload = true
        lock.unlock()
    }
}

// MARK: - Multipart upload session

private actor PartUploadProgressCounter {
    private var completed: Int
    private let totalParts: Int

    init(initialCompleted: Int, totalParts: Int) {
        completed = initialCompleted
        self.totalParts = totalParts
    }

    func markPartComplete() -> Int {
        completed += 1
        guard totalParts > 0 else { return 100 }
        return min(100, Int((Double(completed) / Double(totalParts) * 100).rounded()))
    }
}

private actor UploadSessionCoordinator {
    private struct ActiveSession {
        var cancelled = false
        var uploadedFileId: String?
        var bodyFileURL: URL?
        var resumableServerSessionId: String?
        var inFlight: Task<DriveFile, Error>?
    }

    private var sessions: [String: ActiveSession] = [:]
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 600
        config.timeoutIntervalForResource = 3_600
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    func isCancelled(sessionId: String) -> Bool {
        sessions[sessionId]?.cancelled == true
    }

    func abort(config: ServerConfig, sessionId: String) async {
        guard var entry = sessions[sessionId] else { return }
        entry.cancelled = true
        sessions[sessionId] = entry
        entry.inFlight?.cancel()

        if let fileId = entry.uploadedFileId {
            await UploadService.cancelVideoIngest(config: config, fileId: fileId)
            await UploadService.deleteFile(config: config, fileId: fileId)
        }

        if let serverSessionId = entry.resumableServerSessionId {
            await UploadService.abortResumableUploadSession(config: config, sessionId: serverSessionId)
        }

        if let bodyURL = entry.bodyFileURL {
            try? FileManager.default.removeItem(at: bodyURL)
        }
        sessions[sessionId] = nil
    }

    func upload(
        config: ServerConfig,
        fileURL: URL,
        fileName: String,
        mimeType: String,
        folderId: String?,
        sessionId: String,
        isVideo: Bool,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void,
        existingResumableSessionId: String?
    ) async throws -> DriveFile {
        sessions[sessionId] = ActiveSession()

        if UploadService.shouldUseResumableUpload(fileSize: fileSize(at: fileURL), mimeType: mimeType) {
            return try await uploadResumable(
                config: config,
                fileURL: fileURL,
                fileName: fileName,
                mimeType: mimeType,
                folderId: folderId,
                sessionId: sessionId,
                isVideo: isVideo,
                onProgress: onProgress,
                existingResumableSessionId: existingResumableSessionId
            )
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        let bodyURL = try writeMultipartBody(
            fileURL: fileURL,
            fileName: fileName,
            mimeType: mimeType,
            folderId: folderId,
            boundary: boundary
        )

        sessions[sessionId]?.bodyFileURL = bodyURL

        guard var request = try? UploadService.authorizedRequestForUpload(config: config) else {
            throw UploadServiceError.noServerURL
        }

        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let progressHandler = UploadProgressHandler(isVideo: isVideo, onProgress: onProgress)

        let inFlight = Task<DriveFile, Error> {
            defer {
                try? FileManager.default.removeItem(at: bodyURL)
            }

            let (data, response) = try await session.upload(
                for: request,
                fromFile: bodyURL,
                delegate: progressHandler
            )

            try Task.checkCancellation()

            if await self.isCancelled(sessionId: sessionId) {
                throw UploadServiceError.cancelled
            }

            guard let http = response as? HTTPURLResponse else {
                throw UploadServiceError.network(description: "Invalid response.")
            }

            if http.statusCode == 401 {
                throw UploadServiceError.unauthorized
            }

            guard (200 ..< 300).contains(http.statusCode) else {
                let message = UploadService.parseErrorMessagePublic(from: data) ?? "Upload failed."
                let code = UploadService.parseErrorCodePublic(from: data) ?? "request_failed"
                throw UploadServiceError.server(message: message, code: code)
            }

            let payload = try OwnlyJSON.makeDecoder().decode(UploadFileResponse.self, from: data)
            if var entry = await self.sessions[sessionId] {
                entry.uploadedFileId = payload.file.id
                await self.setSession(sessionId, entry)
            }
            return payload.file
        }

        if var entry = sessions[sessionId] {
            entry.inFlight = inFlight
            sessions[sessionId] = entry
        }

        do {
            let file = try await inFlight.value
            sessions[sessionId] = nil
            return file
        } catch is CancellationError {
            sessions[sessionId] = nil
            throw UploadServiceError.cancelled
        } catch let error as UploadServiceError {
            sessions[sessionId] = nil
            throw error
        } catch let error as URLError where error.code == .cancelled {
            sessions[sessionId] = nil
            throw UploadServiceError.cancelled
        } catch {
            sessions[sessionId] = nil
            throw UploadServiceError.network(description: error.localizedDescription)
        }
    }

    private func setSession(_ sessionId: String, _ entry: ActiveSession) {
        sessions[sessionId] = entry
    }

    private func fileSize(at url: URL) -> Int64 {
        if let values = try? url.resourceValues(forKeys: [.fileSizeKey]), let bytes = values.fileSize {
            return Int64(bytes)
        }
        return 0
    }

    // Human: Chunked resumable upload — create session, PUT missing parts, POST complete.
    // Agent: CALLS /uploads/*; PERSISTS resumableServerSessionId for retry; PARALLEL part PUTs (2).
    private func uploadResumable(
        config: ServerConfig,
        fileURL: URL,
        fileName: String,
        mimeType: String,
        folderId: String?,
        sessionId: String,
        isVideo: Bool,
        onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void,
        existingResumableSessionId: String?
    ) async throws -> DriveFile {
        let totalSize = fileSize(at: fileURL)
        let serverSession = try await ensureResumableSession(
            config: config,
            fileName: fileName,
            mimeType: mimeType,
            folderId: folderId,
            totalSize: totalSize,
            existingSessionId: existingResumableSessionId
        )

        if var entry = sessions[sessionId] {
            entry.resumableServerSessionId = serverSession.sessionId
            sessions[sessionId] = entry
        }

        let received = Set(serverSession.partsReceived)
        let chunkSize = Int64(serverSession.chunkSize)
        var missingParts: [Int] = []
        for part in 0 ..< serverSession.totalParts where !received.contains(part) {
            missingParts.append(part)
        }

        let progressCounter = PartUploadProgressCounter(
            initialCompleted: received.count,
            totalParts: serverSession.totalParts
        )

        let uploadPart: @Sendable (Int) async throws -> Void = { partNumber in
            if await self.isCancelled(sessionId: sessionId) {
                throw UploadServiceError.cancelled
            }
            let offset = Int64(partNumber) * chunkSize
            let length = Int(min(chunkSize, totalSize - offset))
            let chunk = try Self.readFileChunk(fileURL: fileURL, offset: offset, length: length)
            try await Self.putResumablePart(
                config: config,
                sessionId: serverSession.sessionId,
                partNumber: partNumber,
                body: chunk
            )
            let percent = await progressCounter.markPartComplete()
            onProgress(UploadProgressUpdate(phase: .uploading, percent: percent, indeterminate: false))
        }

        try await withThrowingTaskGroup(of: Void.self) { group in
            var nextIndex = 0
            for _ in 0 ..< min(UploadService.resumablePartConcurrency, missingParts.count) {
                let part = missingParts[nextIndex]
                nextIndex += 1
                group.addTask { try await uploadPart(part) }
            }
            while let _ = try await group.next() {
                if nextIndex < missingParts.count {
                    let part = missingParts[nextIndex]
                    nextIndex += 1
                    group.addTask { try await uploadPart(part) }
                }
            }
        }

        if await isCancelled(sessionId: sessionId) {
            throw UploadServiceError.cancelled
        }

        onProgress(UploadProgressUpdate(phase: .uploading, percent: 100, indeterminate: false))
        if isVideo {
            onProgress(UploadProgressUpdate(phase: .processing, percent: 0, indeterminate: false))
        }

        let payload: UploadFileResponse = try await Self.completeResumableSession(
            config: config,
            sessionId: serverSession.sessionId
        )

        if var entry = sessions[sessionId] {
            entry.uploadedFileId = payload.file.id
            sessions[sessionId] = entry
        }

        return payload.file
    }

    private struct ResumableUploadSessionPayload: Decodable {
        let sessionId: String
        let chunkSize: Int
        let totalParts: Int
        let partsReceived: [Int]

        enum CodingKeys: String, CodingKey {
            case sessionId = "session_id"
            case chunkSize = "chunk_size"
            case totalParts = "total_parts"
            case partsReceived = "parts_received"
        }
    }

    private func ensureResumableSession(
        config: ServerConfig,
        fileName: String,
        mimeType: String,
        folderId: String?,
        totalSize: Int64,
        existingSessionId: String?
    ) async throws -> ResumableUploadSessionPayload {
        if let existingSessionId {
            guard let request = try? UploadService.authorizedRequest(
                config: config,
                path: "/uploads/\(existingSessionId)",
                method: "GET"
            ) else {
                throw UploadServiceError.noServerURL
            }
            let (data, response) = try await URLSession.shared.data(for: request)
            return try UploadService.decodeResponse(data: data, response: response)
        }

        var body: [String: Any] = [
            "filename": fileName,
            "total_size": totalSize,
            "content_type": mimeType,
            "chunk_size": UploadService.uploadChunkSizeBytes,
        ]
        if let folderId {
            body["folder_id"] = folderId
        }
        let json = try JSONSerialization.data(withJSONObject: body)

        guard var request = try? UploadService.authorizedRequest(config: config, path: "/uploads", method: "POST") else {
            throw UploadServiceError.noServerURL
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = json

        let (data, response) = try await URLSession.shared.data(for: request)
        return try UploadService.decodeResponse(data: data, response: response)
    }

    private func writeMultipartBody(
        fileURL: URL,
        fileName: String,
        mimeType: String,
        folderId: String?,
        boundary: String
    ) throws -> URL {
        let bodyURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("upload-body-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: bodyURL.path, contents: nil)

        guard let handle = try? FileHandle(forWritingTo: bodyURL) else {
            throw UploadServiceError.network(description: "Could not create upload body.")
        }
        defer { try? handle.close() }

        func append(_ string: String) throws {
            if let data = string.data(using: .utf8) {
                try handle.write(contentsOf: data)
            }
        }

        if let folderId {
            try append("--\(boundary)\r\n")
            try append("Content-Disposition: form-data; name=\"folder_id\"\r\n\r\n")
            try append("\(folderId)\r\n")
        }

        try append("--\(boundary)\r\n")
        try append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n")
        try append("Content-Type: \(mimeType)\r\n\r\n")

        if let input = try? FileHandle(forReadingFrom: fileURL) {
            defer { try? input.close() }
            while true {
                let chunk = try input.read(upToCount: 512 * 1024)
                guard let chunk, !chunk.isEmpty else { break }
                try handle.write(contentsOf: chunk)
            }
        }

        try append("\r\n--\(boundary)--\r\n")
        return bodyURL
    }
}

// Human: Reports multipart byte progress while `URLSession.upload(for:fromFile:delegate:)` runs.
// Agent: IMPLEMENTS URLSessionTaskDelegate didSendBodyData; USED only during active uploads.
private final class UploadProgressHandler: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let isVideo: Bool
    let onProgress: @Sendable (UploadProgressUpdate) -> Void

    init(isVideo: Bool, onProgress: @escaping @Sendable (UploadProgressUpdate) -> Void) {
        self.isVideo = isVideo
        self.onProgress = onProgress
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        if totalBytesExpectedToSend > 0 {
            let ratio = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
            let percent = min(100, Int((ratio * 100).rounded()))
            onProgress(UploadProgressUpdate(phase: .uploading, percent: percent, indeterminate: false))
            if ratio >= 1, isVideo {
                onProgress(UploadProgressUpdate(phase: .processing, percent: 0, indeterminate: false))
            }
        } else if bytesSent > 0 {
            onProgress(UploadProgressUpdate(phase: .uploading, percent: 50, indeterminate: false))
        }
    }
}

extension UploadService {
    fileprivate static func authorizedRequestForUpload(config: ServerConfig) throws -> URLRequest {
        try authorizedRequest(config: config, path: "/files/upload", method: "POST")
    }

    fileprivate static func readFileChunk(fileURL: URL, offset: Int64, length: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(offset))
        guard let data = try handle.read(upToCount: length), !data.isEmpty else {
            return Data()
        }
        return data
    }

    fileprivate static func putResumablePart(
        config: ServerConfig,
        sessionId: String,
        partNumber: Int,
        body: Data
    ) async throws {
        guard var request = try? UploadService.authorizedRequest(
            config: config,
            path: "/uploads/\(sessionId)/parts/\(partNumber)",
            method: "PUT"
        ) else {
            throw UploadServiceError.noServerURL
        }
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            let message = parseErrorMessagePublic(from: data) ?? "Upload part failed."
            let code = parseErrorCodePublic(from: data) ?? "request_failed"
            throw UploadServiceError.server(message: message, code: code)
        }
    }

    fileprivate static func completeResumableSession(
        config: ServerConfig,
        sessionId: String
    ) async throws -> UploadFileResponse {
        guard var request = try? UploadService.authorizedRequest(
            config: config,
            path: "/uploads/\(sessionId)/complete",
            method: "POST"
        ) else {
            throw UploadServiceError.noServerURL
        }
        request.httpBody = Data()
        let (data, response) = try await URLSession.shared.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    fileprivate static func parseErrorMessagePublic(from data: Data) -> String? {
        parseErrorMessage(from: data)
    }

    fileprivate static func parseErrorCodePublic(from data: Data) -> String? {
        parseErrorCode(from: data)
    }
}
