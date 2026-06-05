import Foundation

// Human: Quick reachability probe for the configured Ownly instance before sign-in.
// Agent: GET `/setup/status`; RETURNS healthy when HTTP 2xx; unreachable on network/HTTP errors.
enum TenantHealthResult: Equatable {
    case checking
    case healthy
    case degraded
    case unreachable(message: String?)
}

enum TenantHealthChecker {
    private static let timeout: TimeInterval = 8

    static func check(config: ServerConfig) async -> TenantHealthResult {
        guard let url = config.requestURL(path: "/setup/status") else {
            return .unreachable(message: "No server URL")
        }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        AppIdentity.apply(to: &request)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unreachable(message: "Invalid response")
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                return .unreachable(message: "HTTP \(http.statusCode)")
            }
            return .healthy
        } catch {
            let message = (error as? URLError)?.localizedDescription ?? error.localizedDescription
            return .unreachable(message: message)
        }
    }
}
