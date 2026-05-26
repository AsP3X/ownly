import Foundation

// Human: Codable shapes for MediaVault auth API requests and responses.
// Agent: MATCHES backend JSON for login, register, and registration settings.
struct AuthUser: Codable, Sendable, Equatable {
    let id: String
    let email: String
    let role: String
    let enabled: Bool
}

struct AuthResponse: Codable, Sendable {
    let token: String?
    let pendingActivation: Bool?
    let user: AuthUser

    enum CodingKeys: String, CodingKey {
        case token
        case pendingActivation = "pending_activation"
        case user
    }
}

struct LoginRequest: Encodable, Sendable {
    let email: String
    let password: String
}

struct RegisterRequest: Encodable, Sendable {
    let email: String
    let password: String
}

struct RegistrationSettingResponse: Decodable, Sendable {
    let allowPublicRegistration: Bool

    enum CodingKeys: String, CodingKey {
        case allowPublicRegistration = "allow_public_registration"
    }
}

struct SetupStatusResponse: Decodable, Sendable {
    let setupComplete: Bool

    enum CodingKeys: String, CodingKey {
        case setupComplete = "setup_complete"
    }
}

struct APIErrorBody: Decodable {
    struct Detail: Decodable {
        let code: String
        let message: String
    }

    let error: Detail
}

enum AuthLoginFailure: Equatable, Error {
    case noServerURL
    case invalidCredentials
    case serverError(message: String)
    case networkError(description: String)
}

enum AuthRegisterFailure: Equatable, Error {
    case noServerURL
    case serverError(message: String)
    case networkError(description: String)
}
