import Foundation

// Human: Authenticated drive listing client for folders and files under `/api/v1`.
// Agent: READS AuthTokenStorage Bearer; CALLS GET /folders GET /files; RETURNS DriveServiceError on 401/network.
enum DriveService {
    static let pageSize = 200
    private static let timeout: TimeInterval = 30

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

    static func downloadImageData(config: ServerConfig, fileId: String) async -> Data? {
        guard let request = try? authorizedRequest(config: config, path: "/files/\(fileId)/download") else {
            return nil
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
                return nil
            }
            return data
        } catch {
            return nil
        }
    }

    // MARK: - Request helpers

    private static func authorizedGET<T: Decodable>(
        config: ServerConfig,
        path: String,
        query: [URLQueryItem]
    ) async -> Result<T, DriveServiceError> {
        guard let request = try? authorizedRequest(config: config, path: path, query: query) else {
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
                let message = parseErrorMessage(from: data) ?? "Request failed."
                return .failure(.server(message: message))
            }

            let decoded = try MediaVaultJSON.makeDecoder().decode(T.self, from: data)
            return .success(decoded)
        } catch let error as DecodingError {
            return .failure(.network(description: decodingMessage(error)))
        } catch {
            return .failure(.network(description: error.localizedDescription))
        }
    }

    private static func authorizedRequest(
        config: ServerConfig,
        path: String,
        query: [URLQueryItem] = []
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
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
