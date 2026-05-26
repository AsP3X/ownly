import Foundation
import Observation

// Human: Runtime API base URL chosen during onboarding (overrides Info.plist default).
// Agent: READS/WRITES Keychain; NOTIFY observers when URL changes.
@Observable
final class ServerConfiguration {
    static let shared = ServerConfiguration()

    private static let service = "com.mediavault.ios.server"
    private static let account = "apiBaseURL"

    private(set) var apiBaseURL: URL?

    var hasConfiguredServer: Bool {
        apiBaseURL != nil
    }

    private init() {
        if let stored = KeychainStore.load(service: Self.service, account: Self.account),
           let url = URL(string: stored) {
            apiBaseURL = url
        }
    }

    func setAPIBaseURL(_ url: URL) throws {
        try KeychainStore.save(url.absoluteString, service: Self.service, account: Self.account)
        apiBaseURL = url
    }

    func clear() {
        KeychainStore.delete(service: Self.service, account: Self.account)
        apiBaseURL = nil
    }

    /// Normalizes user input into a `/api/v1` base URL when the suffix is missing.
    static func normalizeURLString(_ raw: String) -> URL? {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        while trimmed.hasSuffix("/") {
            trimmed.removeLast()
        }

        if !trimmed.lowercased().hasSuffix("/api/v1") {
            trimmed += "/api/v1"
        }

        return URL(string: trimmed)
    }

    var displayHost: String {
        guard let apiBaseURL else { return "Not connected" }
        return apiBaseURL.host ?? apiBaseURL.absoluteString
    }
}
