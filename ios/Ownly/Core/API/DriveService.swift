import Foundation

// Human: Authenticated drive listing client for folders and files under `/api/v1`.
// Agent: READS AuthTokenStorage Bearer; CALLS GET /folders GET /files; RETURNS DriveServiceError on 401/network.
enum DriveService {
    static let pageSize = 200
    private static let timeout: TimeInterval = 30
    /// Large video exports can take several minutes over the API proxy.
    private static let downloadTimeout: TimeInterval = 60 * 30
    private static let minimumVideoExportBytes: Int64 = 4096

    static func listFolders(
        config: ServerConfig,
        parentId: String?,
        offset: Int = 0,
        limit: Int = 200
    ) async -> Result<FolderListResponse, DriveServiceError> {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(max(0, offset))),
        ]
        if let parentId {
            query.append(URLQueryItem(name: "parent_id", value: parentId))
        }

        return await authorizedGET(config: config, path: "/folders", query: query)
    }

    static func listFiles(
        config: ServerConfig,
        folderId: String?,
        query searchQuery: String? = nil,
        offset: Int = 0,
        limit: Int = 200
    ) async -> Result<FileListResponse, DriveServiceError> {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(max(0, offset))),
            URLQueryItem(name: "fields", value: "minimal"),
        ]

        let trimmed = searchQuery?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            query.append(URLQueryItem(name: "q", value: trimmed))
        } else if let folderId {
            query.append(URLQueryItem(name: "folder_id", value: folderId))
        }

        return await authorizedGET(config: config, path: "/files", query: query)
    }

    static func fetchVideoStreamURL(
        config: ServerConfig,
        fileId: String
    ) async -> Result<VideoStreamURLResponse, DriveServiceError> {
        await authorizedGET(config: config, path: "/files/\(fileId)/stream-url", query: [])
    }

    static func downloadImageData(config: ServerConfig, fileId: String) async -> Data? {
        switch await downloadFileData(config: config, fileId: fileId) {
        case .success(let data):
            return data
        case .failure:
            return nil
        }
    }

    static func downloadFileData(
        config: ServerConfig,
        fileId: String
    ) async -> Result<Data, DriveServiceError> {
        await authorizedData(config: config, path: "/files/\(fileId)/download")
    }

    static func startVideoExport(
        config: ServerConfig,
        fileId: String
    ) async -> Result<VideoExportStatus, DriveServiceError> {
        await authorizedJSON(
            config: config,
            path: "/files/\(fileId)/export",
            method: "POST",
            body: EmptyBody()
        )
    }

    static func fetchVideoExportStatus(
        config: ServerConfig,
        fileId: String
    ) async -> Result<VideoExportStatus, DriveServiceError> {
        await authorizedGET(config: config, path: "/files/\(fileId)/export", query: [])
    }

    /// Blocks until `export.mp4` exists for HLS-stored videos (idempotent when already cached).
    /// Returns expected export size in bytes when the server reports it (used to validate the download).
    static func ensureVideoExportReady(
        config: ServerConfig,
        fileId: String,
        onProgress: (@Sendable (Int) -> Void)? = nil
    ) async -> Result<Int64?, DriveServiceError> {
        switch await startVideoExport(config: config, fileId: fileId) {
        case .failure(let error):
            return .failure(error)
        case .success:
            break
        }

        for _ in 0 ..< 600 {
            if Task.isCancelled {
                return .failure(.cancelled)
            }

            switch await fetchVideoExportStatus(config: config, fileId: fileId) {
            case .failure(let error):
                return .failure(error)
            case .success(let status):
                let percent = min(100, max(0, status.ready ? 100 : status.progress))
                onProgress?(percent)

                if status.ready {
                    return .success(status.sizeBytes)
                }
                if status.status == "failed" {
                    let message = status.error ?? "Video export failed."
                    return .failure(.server(message: message))
                }
            }

            try? await Task.sleep(for: .seconds(1))
        }

        return .failure(.server(message: "Video export timed out."))
    }

    static func fetchFileDownloadURL(
        config: ServerConfig,
        fileId: String
    ) async -> Result<FileDownloadURLResponse, DriveServiceError> {
        await authorizedGET(config: config, path: "/files/\(fileId)/download-url", query: [])
    }

    /// Downloads a drive file to a temp URL suitable for the system share sheet (MP4 for HLS videos).
    static func downloadFileForSharing(
        config: ServerConfig,
        file: DriveFile,
        onExportProgress: (@Sendable (Int) -> Void)? = nil
    ) async -> Result<URL, DriveServiceError> {
        var expectedBytes: Int64? = file.isHlsStoredVideo ? nil : file.sizeBytes

        if file.isHlsStoredVideo {
            switch await ensureVideoExportReady(
                config: config,
                fileId: file.id,
                onProgress: onExportProgress
            ) {
            case .failure(let error):
                return .failure(error)
            case .success(let exportBytes):
                expectedBytes = exportBytes ?? file.sizeBytes
            }
        }

        let downloadName = file.isHlsStoredVideo ? file.mp4DownloadName : file.name
        let requiresMp4 = file.isHlsStoredVideo

        switch await downloadFileToTemporaryURL(
            config: config,
            fileId: file.id,
            preferredFilename: downloadName,
            expectedMinBytes: expectedBytes,
            requiresMp4: requiresMp4
        ) {
        case .success(let url):
            return .success(url)
        case .failure(let primaryError):
            switch await downloadFileViaPresignedURL(
                config: config,
                fileId: file.id,
                preferredFilename: downloadName,
                expectedMinBytes: expectedBytes,
                requiresMp4: requiresMp4
            ) {
            case .success(let url):
                return .success(url)
            case .failure:
                return .failure(primaryError)
            }
        }
    }

    private static func downloadFileToTemporaryURL(
        config: ServerConfig,
        fileId: String,
        preferredFilename: String,
        expectedMinBytes: Int64?,
        requiresMp4: Bool
    ) async -> Result<URL, DriveServiceError> {
        guard let request = try? authorizedBinaryRequest(
            config: config,
            path: "/files/\(fileId)/download"
        ) else {
            return .failure(.noServerURL)
        }

        return await performFileDownload(
            request: request,
            preferredFilename: preferredFilename,
            expectedMinBytes: expectedMinBytes,
            requiresMp4: requiresMp4
        )
    }

    private static func downloadFileViaPresignedURL(
        config: ServerConfig,
        fileId: String,
        preferredFilename: String,
        expectedMinBytes: Int64?,
        requiresMp4: Bool
    ) async -> Result<URL, DriveServiceError> {
        switch await fetchFileDownloadURL(config: config, fileId: fileId) {
        case .failure(let error):
            return .failure(error)
        case .success(let response):
            guard let url = URL(string: response.url) else {
                return .failure(.server(message: "Invalid download URL from server."))
            }
            var request = URLRequest(url: url, timeoutInterval: downloadTimeout)
            request.httpMethod = "GET"
            request.setValue("*/*", forHTTPHeaderField: "Accept")
            return await performFileDownload(
                request: request,
                preferredFilename: preferredFilename,
                expectedMinBytes: expectedMinBytes,
                requiresMp4: requiresMp4
            )
        }
    }

    private static func performFileDownload(
        request: URLRequest,
        preferredFilename: String,
        expectedMinBytes: Int64?,
        requiresMp4: Bool
    ) async -> Result<URL, DriveServiceError> {
        do {
            let (tempURL, response) = try await URLSession.shared.download(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.network(description: "Invalid response."))
            }
            if http.statusCode == 401 {
                return .failure(.unauthorized)
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                let errorData = (try? Data(contentsOf: tempURL)) ?? Data()
                try? FileManager.default.removeItem(at: tempURL)
                let message = parseErrorMessage(from: errorData) ?? "Download failed."
                return .failure(.server(message: message))
            }

            let safeName = sanitizedFilename(preferredFilename)
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("Ownly-\(UUID().uuidString)-\(safeName)")
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: tempURL, to: destination)

            switch validateDownloadedFile(
                at: destination,
                expectedMinBytes: expectedMinBytes,
                requiresMp4: requiresMp4
            ) {
            case .failure(let error):
                try? FileManager.default.removeItem(at: destination)
                return .failure(error)
            case .success:
                return .success(destination)
            }
        } catch {
            return .failure(mapRequestError(error))
        }
    }

    private static func authorizedBinaryRequest(
        config: ServerConfig,
        path: String,
        method: String = "GET"
    ) throws -> URLRequest {
        var request = try authorizedRequest(config: config, path: path, method: method)
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        request.timeoutInterval = downloadTimeout
        return request
    }

    private static func sanitizedFilename(_ name: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\:")
        let cleaned = name.unicodeScalars
            .map { invalid.contains($0) ? "_" : Character($0) }
        let collapsed = String(cleaned)
            .replacingOccurrences(of: "..", with: "_")
        return collapsed.isEmpty ? "download.bin" : collapsed
    }

    private static func validateDownloadedFile(
        at url: URL,
        expectedMinBytes: Int64?,
        requiresMp4: Bool
    ) -> Result<Void, DriveServiceError> {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let byteCount = (attributes?[.size] as? NSNumber)?.int64Value ?? 0

        if let expected = expectedMinBytes, expected > 0 {
            let floor = max(minimumVideoExportBytes, Int64(Double(expected) * 0.9))
            if byteCount < floor {
                return .failure(.server(message: "Download incomplete (\(byteCount) of \(expected) bytes)."))
            }
        } else if requiresMp4, byteCount < minimumVideoExportBytes {
            return .failure(.server(message: "Downloaded file is too small to be a valid video."))
        }

        if requiresMp4 {
            switch mp4FileLooksValid(at: url) {
            case false:
                return .failure(.server(message: "Downloaded file is not a valid MP4 video."))
            case true:
                break
            }
        }

        return .success(())
    }

    /// Quick check for ISO BMFF `ftyp` box — rejects JSON error bodies saved as `.mp4`.
    private static func mp4FileLooksValid(at url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        guard let prefix = try? handle.read(upToCount: 12), prefix.count >= 8 else { return false }
        let ftyp = prefix[4 ..< 8]
        return ftyp.elementsEqual([0x66, 0x74, 0x79, 0x70])
    }

    static func deleteFile(
        config: ServerConfig,
        fileId: String
    ) async -> Result<Void, DriveServiceError> {
        await authorizedVoid(config: config, path: "/files/\(fileId)", method: "DELETE")
    }

    static func deleteFolder(
        config: ServerConfig,
        folderId: String
    ) async -> Result<Void, DriveServiceError> {
        await authorizedVoid(config: config, path: "/folders/\(folderId)", method: "DELETE")
    }

    static func lookupPublicShare(
        config: ServerConfig,
        fileId: String? = nil,
        folderId: String? = nil
    ) async -> Result<ShareLink?, DriveServiceError> {
        var query: [URLQueryItem] = []
        if let fileId {
            query.append(URLQueryItem(name: "file_id", value: fileId))
        } else if let folderId {
            query.append(URLQueryItem(name: "folder_id", value: folderId))
        }

        let result: Result<ShareLookupResponse, DriveServiceError> = await authorizedGET(
            config: config,
            path: "/shares",
            query: query
        )
        switch result {
        case .success(let response):
            return .success(response.share)
        case .failure(let error):
            return .failure(error)
        }
    }

    static func createPublicShare(
        config: ServerConfig,
        resourceType: String,
        resourceId: String
    ) async -> Result<ShareLink, DriveServiceError> {
        struct Payload: Encodable {
            let resourceType: String
            let resourceId: String

            enum CodingKeys: String, CodingKey {
                case resourceType = "resource_type"
                case resourceId = "resource_id"
            }
        }

        let result: Result<ShareCreateResponse, DriveServiceError> = await authorizedJSON(
            config: config,
            path: "/shares",
            method: "POST",
            body: Payload(resourceType: resourceType, resourceId: resourceId)
        )
        switch result {
        case .success(let response):
            return .success(response.share)
        case .failure(let error):
            return .failure(error)
        }
    }

    /// Creates a share when missing and returns the visitor-facing `/s/{token}` URL.
    static func ensurePublicSharePageURL(
        config: ServerConfig,
        resourceType: String,
        resourceId: String
    ) async -> Result<URL, DriveServiceError> {
        let lookup = await lookupPublicShare(
            config: config,
            fileId: resourceType == "file" ? resourceId : nil,
            folderId: resourceType == "folder" ? resourceId : nil
        )

        switch lookup {
        case .failure(let error):
            return .failure(error)
        case .success(let existing):
            if let existing, let url = config.publicSharePageURL(token: existing.token) {
                return .success(url)
            }

            let created = await createPublicShare(
                config: config,
                resourceType: resourceType,
                resourceId: resourceId
            )
            switch created {
            case .failure(let error):
                return .failure(error)
            case .success(let share):
                guard let url = config.publicSharePageURL(token: share.token) else {
                    return .failure(.noServerURL)
                }
                return .success(url)
            }
        }
    }

    static func revokePublicShare(
        config: ServerConfig,
        shareId: String
    ) async -> Result<Void, DriveServiceError> {
        await authorizedVoid(config: config, path: "/shares/\(shareId)", method: "DELETE")
    }

    static func fetchResourceShares(
        config: ServerConfig,
        fileId: String? = nil,
        folderId: String? = nil
    ) async -> Result<ResourceSharesResponse, DriveServiceError> {
        var query: [URLQueryItem] = []
        if let fileId {
            query.append(URLQueryItem(name: "file_id", value: fileId))
        } else if let folderId {
            query.append(URLQueryItem(name: "folder_id", value: folderId))
        }
        return await authorizedGET(config: config, path: "/shares/resource", query: query)
    }

    static func startFolderDownload(
        config: ServerConfig,
        folderId: String
    ) async -> Result<FolderDownloadStatus, DriveServiceError> {
        await authorizedJSON(
            config: config,
            path: "/folders/\(folderId)/download",
            method: "POST",
            body: EmptyBody()
        )
    }

    static func fetchFolderDownloadStatus(
        config: ServerConfig,
        folderId: String
    ) async -> Result<FolderDownloadStatus, DriveServiceError> {
        await authorizedGET(config: config, path: "/folders/\(folderId)/download", query: [])
    }

    /// Polls the folder zip job, downloads the archive to a temp file, and returns its URL.
    static func downloadFolderArchive(
        config: ServerConfig,
        folder: DriveFolder
    ) async -> Result<URL, DriveServiceError> {
        switch await startFolderDownload(config: config, folderId: folder.id) {
        case .failure(let error):
            return .failure(error)
        case .success:
            break
        }

        var archiveName = "\(folder.name).zip"

        for _ in 0 ..< 600 {
            try? await Task.sleep(for: .seconds(1))

            switch await fetchFolderDownloadStatus(config: config, folderId: folder.id) {
            case .failure(let error):
                return .failure(error)
            case .success(let status):
                archiveName = status.archiveName

                if status.status == "failed" {
                    return .failure(.server(message: status.error ?? "Folder archive failed."))
                }

                if status.ready {
                    switch await downloadFolderArchiveBytes(
                        config: config,
                        folderId: folder.id,
                        archiveName: archiveName
                    ) {
                    case .success(let url):
                        return .success(url)
                    case .failure(let error):
                        return .failure(error)
                    }
                }
            }
        }

        return .failure(.server(message: "Folder download timed out."))
    }

    private static func downloadFolderArchiveBytes(
        config: ServerConfig,
        folderId: String,
        archiveName: String
    ) async -> Result<URL, DriveServiceError> {
        switch await authorizedData(config: config, path: "/folders/\(folderId)/download/archive") {
        case .failure(let error):
            return .failure(error)
        case .success(let data):
            let safeName = archiveName.isEmpty ? "folder.zip" : archiveName
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("Ownly-\(UUID().uuidString)-\(safeName)")
            do {
                try data.write(to: destination, options: .atomic)
                return .success(destination)
            } catch {
                return .failure(.network(description: error.localizedDescription))
            }
        }
    }

    // MARK: - Request helpers

    private struct EmptyBody: Encodable {}

    private static func authorizedGET<T: Decodable>(
        config: ServerConfig,
        path: String,
        query: [URLQueryItem]
    ) async -> Result<T, DriveServiceError> {
        guard let request = try? authorizedRequest(config: config, path: path, method: "GET", query: query) else {
            return .failure(.noServerURL)
        }
        return await performDecodable(request: request)
    }

    private static func authorizedJSON<T: Decodable, Body: Encodable>(
        config: ServerConfig,
        path: String,
        method: String,
        body: Body
    ) async -> Result<T, DriveServiceError> {
        guard let encoded = try? OwnlyJSON.makeEncoder().encode(body) else {
            return .failure(.network(description: "Could not encode request."))
        }
        guard let request = try? authorizedRequest(
            config: config,
            path: path,
            method: method,
            query: [],
            body: encoded,
            contentType: "application/json"
        ) else {
            return .failure(.noServerURL)
        }
        return await performDecodable(request: request)
    }

    private static func authorizedVoid(
        config: ServerConfig,
        path: String,
        method: String
    ) async -> Result<Void, DriveServiceError> {
        guard let request = try? authorizedRequest(config: config, path: path, method: method) else {
            return .failure(.noServerURL)
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.network(description: "Invalid response."))
            }
            if http.statusCode == 401 {
                return .failure(.unauthorized)
            }
            if http.statusCode == 404, method == "DELETE" {
                return .success(())
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                let message = parseErrorMessage(from: data) ?? "Request failed."
                return .failure(.server(message: message))
            }
            return .success(())
        } catch {
            return .failure(mapRequestError(error))
        }
    }

    private static func authorizedData(
        config: ServerConfig,
        path: String
    ) async -> Result<Data, DriveServiceError> {
        guard let request = try? authorizedRequest(config: config, path: path, method: "GET") else {
            return .failure(.noServerURL)
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.network(description: "Invalid response."))
            }
            if http.statusCode == 401 {
                return .failure(.unauthorized)
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                let message = parseErrorMessage(from: data) ?? "Download failed."
                return .failure(.server(message: message))
            }
            return .success(data)
        } catch {
            return .failure(mapRequestError(error))
        }
    }

    private static func performDecodable<T: Decodable>(request: URLRequest) async -> Result<T, DriveServiceError> {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.network(description: "Invalid response."))
            }

            if http.statusCode == 401 {
                return .failure(.unauthorized)
            }

            guard (200 ..< 300).contains(http.statusCode) else {
                let message = parseErrorMessage(from: data) ?? "Request failed."
                return .failure(.server(message: message))
            }

            let decoded = try OwnlyJSON.makeDecoder().decode(T.self, from: data)
            return .success(decoded)
        } catch let error as DecodingError {
            return .failure(.network(description: decodingMessage(error)))
        } catch {
            return .failure(mapRequestError(error))
        }
    }

    /// Maps URLSession/task cancellation to `.cancelled` so UI can ignore benign refresh races.
    private static func mapRequestError(_ error: Error) -> DriveServiceError {
        if error is CancellationError {
            return .cancelled
        }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            return .cancelled
        }
        return .network(description: error.localizedDescription)
    }

    private static func authorizedRequest(
        config: ServerConfig,
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: Data? = nil,
        contentType: String? = nil
    ) throws -> URLRequest {
        guard var components = URLComponents(url: config.requestURL(path: path) ?? URL(fileURLWithPath: "/"), resolvingAgainstBaseURL: false) else {
            throw DriveServiceError.noServerURL
        }

        if !query.isEmpty {
            components.queryItems = query
        }

        guard let url = components.url else {
            throw DriveServiceError.noServerURL
        }

        guard let token = AuthTokenStorage.getToken(), !token.isEmpty else {
            throw DriveServiceError.unauthorized
        }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body
        AppIdentity.apply(to: &request)
        return request
    }

    private static func parseErrorMessage(from data: Data) -> String? {
        guard let body = try? JSONDecoder().decode(APIErrorBody.self, from: data) else { return nil }
        return body.error.message
    }

    private static func decodingMessage(_ error: DecodingError) -> String {
        switch error {
        case .keyNotFound(let key, let context):
            "Missing field \"\(key.stringValue)\" in server response (\(context.codingPath.map(\.stringValue).joined(separator: ".")))."
        case .typeMismatch(let type, let context):
            "Unexpected type for \"\(context.codingPath.map(\.stringValue).joined(separator: "."))\" (expected \(type))."
        case .valueNotFound(let type, let context):
            "Missing value for \"\(context.codingPath.map(\.stringValue).joined(separator: "."))\" (expected \(type))."
        case .dataCorrupted(let context):
            context.debugDescription
        @unknown default:
            error.localizedDescription
        }
    }
}
