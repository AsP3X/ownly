import Foundation

// Human: Minimal URLSession wrapper for MediaVault JSON APIs.
// Agent: READS AppConfiguration.apiBaseURL; ATTACHES Bearer token when provided; PARSES APIErrorResponse.
actor APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
    }

    /// Performs a JSON request against a path relative to `/api/v1`.
    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        bearerToken: String? = nil
    ) async throws -> T {
        let base = AppConfiguration.apiBaseURL
        let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard let url = URL(string: normalizedPath, relativeTo: base)?.absoluteURL else {
            throw APIClientError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
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
}
