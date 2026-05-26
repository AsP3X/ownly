import Foundation

// Human: Minimal URLSession wrapper for MediaVault JSON APIs.
// Agent: READS ServerConfiguration or override base URL; ATTACHES Bearer token; PARSES APIErrorResponse.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    /// Performs a JSON request against a path relative to `/api/v1`.
    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        bearerToken: String? = nil,
        baseURL: URL? = nil
    ) async throws -> T {
        let resolvedBase = baseURL ?? AppConfiguration.apiBaseURL
        guard let url = Self.requestURL(baseURL: resolvedBase, path: path) else {
            throw APIClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        guard (200 ..< 300).contains(http.statusCode) else {
            let body = try? decoder.decode(APIErrorResponse.self, from: data).error
            throw APIClientError.httpStatus(http.statusCode, body)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIClientError.decodingFailed
        }
    }

    /// Builds `…/api/v1/setup/status` style URLs without Swift's relative-URL pitfall.
    /// Agent: APPENDS path segments to base; AVOIDS `URL(string:relativeTo:)` replacing `/v1`.
    private static func requestURL(baseURL: URL, path: String) -> URL? {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") {
            base.removeLast()
        }

        var normalizedPath = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedPath.hasPrefix("/") {
            normalizedPath = "/\(normalizedPath)"
        }

        return URL(string: base + normalizedPath)
    }
}

// Human: Type-erased Encodable wrapper for generic JSON request bodies.
// Agent: USED by APIClient.request when encoding POST payloads.
private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ wrapped: any Encodable) {
        encodeClosure = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
