import Foundation

// Human: Persists the Ownly API base URL used by auth and future drive features.
// Agent: READS/WRITES UserDefaults; BUILDS request URLs relative to `/api/v1`.
struct ServerConfig: Equatable {
    var host: String
    var port: Int
    var useHTTPS: Bool

    static let defaultHost = "127.0.0.1"
    static let defaultPort = 3000
    static let apiPathPrefix = "api/v1"

    static let defaults = ServerConfig(
        host: defaultHost,
        port: defaultPort,
        useHTTPS: false
    )

    /// Full API base URL, e.g. `http://127.0.0.1:3000/api/v1`.
    var apiBaseURL: URL? {
        var components = URLComponents()
        components.scheme = useHTTPS ? "https" : "http"
        components.host = host.trimmingCharacters(in: .whitespacesAndNewlines)
        components.port = port > 0 ? port : nil
        components.path = "/\(Self.apiPathPrefix)"
        return components.url
    }

    var displayHost: String {
        apiBaseURL?.host ?? host
    }

    func requestURL(path: String) -> URL? {
        guard let base = apiBaseURL else { return nil }
        var baseString = base.absoluteString
        while baseString.hasSuffix("/") {
            baseString.removeLast()
        }

        var normalized = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalized.hasPrefix("/") {
            normalized = "/\(normalized)"
        }

        return URL(string: baseString + normalized)
    }

    /// Resolves absolute `http(s)://…` URLs or API paths (`/api/v1/…` or `/files/…`) against `apiBaseURL`.
    /// Web app origin for public share pages (`/s/{token}`), without the `/api/v1` prefix.
    var webOriginURL: URL? {
        var components = URLComponents()
        components.scheme = useHTTPS ? "https" : "http"
        components.host = host.trimmingCharacters(in: .whitespacesAndNewlines)
        components.port = port > 0 ? port : nil
        components.path = "/"
        return components.url
    }

    func publicSharePageURL(token: String) -> URL? {
        webOriginURL?.appending(path: "s/\(token)")
    }

    func resolveAPIURL(_ pathOrURL: String) -> URL? {
        let trimmed = pathOrURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") {
            return URL(string: trimmed)
        }

        var normalized = trimmed
        let apiPrefix = "/\(Self.apiPathPrefix)"
        if normalized.hasPrefix(apiPrefix) {
            normalized = String(normalized.dropFirst(apiPrefix.count))
        }
        if !normalized.hasPrefix("/") {
            normalized = "/\(normalized)"
        }
        return requestURL(path: normalized)
    }
}

private enum Keys {
    static let host = "Ownly.serverConfig.host"
    static let port = "Ownly.serverConfig.port"
    static let useHTTPS = "Ownly.serverConfig.useHTTPS"
}

extension ServerConfig {
    static func load() -> ServerConfig {
        let host = UserDefaults.standard.string(forKey: Keys.host) ?? ServerConfig.defaultHost
        let port = UserDefaults.standard.object(forKey: Keys.port) as? Int ?? ServerConfig.defaultPort
        let https = UserDefaults.standard.object(forKey: Keys.useHTTPS) as? Bool ?? false
        return ServerConfig(host: host, port: port, useHTTPS: https)
    }

    func save() {
        UserDefaults.standard.set(host.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.host)
        UserDefaults.standard.set(port, forKey: Keys.port)
        UserDefaults.standard.set(useHTTPS, forKey: Keys.useHTTPS)
    }
}
