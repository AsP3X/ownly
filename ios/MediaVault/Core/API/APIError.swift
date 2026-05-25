import Foundation

// Human: Typed API failure matching the backend `{ error: { code, message } }` envelope.
// Agent: PARSES JSON error bodies from non-2xx HTTP responses.
struct APIErrorResponse: Decodable, Sendable {
    struct Body: Decodable, Sendable {
        let code: String
        let message: String
    }

    let error: Body
}

enum APIClientError: LocalizedError, Sendable {
    case invalidURL
    case invalidResponse
    case httpStatus(Int, APIErrorResponse.Body?)
    case decodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid request URL."
        case .invalidResponse:
            return "The server returned an unexpected response."
        case let .httpStatus(status, body):
            if let body {
                return body.message
            }
            return "Request failed with status \(status)."
        case .decodingFailed:
            return "Could not read the server response."
        }
    }
}
