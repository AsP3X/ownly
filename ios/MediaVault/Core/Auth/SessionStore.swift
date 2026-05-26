import Foundation
import Observation

// Human: Persists the signed-in user session across app launches.
// Agent: READS/WRITES Keychain token + user JSON; DRIVES RootView auth gate.
@Observable
final class SessionStore {
    static let shared = SessionStore()

    private static let service = "com.mediavault.ios.session"
    private static let tokenAccount = "authToken"
    private static let userAccount = "authUser"

    private(set) var token: String?
    private(set) var user: AuthUser?

    var isAuthenticated: Bool {
        token != nil && user != nil
    }

    private init() {
        token = KeychainStore.load(service: Self.service, account: Self.tokenAccount)
        if let raw = KeychainStore.load(service: Self.service, account: Self.userAccount),
           let data = raw.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(AuthUser.self, from: data) {
            user = decoded
        }
    }

    func applyAuthResponse(_ response: AuthResponse) throws {
        guard let token = response.token else {
            throw SessionError.missingToken
        }
        try persist(token: token, user: response.user)
    }

    func persist(token: String, user: AuthUser) throws {
        try KeychainStore.save(token, service: Self.service, account: Self.tokenAccount)
        let userData = try JSONEncoder().encode(user)
        guard let userJSON = String(data: userData, encoding: .utf8) else {
            throw SessionError.encodingFailed
        }
        try KeychainStore.save(userJSON, service: Self.service, account: Self.userAccount)
        self.token = token
        self.user = user
    }

    func signOut() {
        KeychainStore.delete(service: Self.service, account: Self.tokenAccount)
        KeychainStore.delete(service: Self.service, account: Self.userAccount)
        token = nil
        user = nil
    }

    enum SessionError: LocalizedError {
        case missingToken
        case encodingFailed

        var errorDescription: String? {
            switch self {
            case .missingToken:
                return "Sign in did not return a session token."
            case .encodingFailed:
                return "Could not save your profile."
            }
        }
    }
}
