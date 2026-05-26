import Foundation

// Human: Central place for environment-specific iOS app settings.
// Agent: READS ServerConfiguration override first, then Info.plist API_BASE_URL fallback.
enum AppConfiguration {
    private static let defaultAPIBaseURL = URL(string: "http://127.0.0.1:3000/api/v1")!

    /// Base URL for `/api/v1` requests (no trailing slash).
    static var apiBaseURL: URL {
        if let configured = ServerConfiguration.shared.apiBaseURL {
            return configured
        }
        return plistAPIBaseURL
    }

    private static var plistAPIBaseURL: URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
            let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            !raw.isEmpty
        else {
            return defaultAPIBaseURL
        }
        return url
    }
}
