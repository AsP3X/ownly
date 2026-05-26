import Foundation

// Human: Typed MediaVault API calls used by onboarding and auth flows.
// Agent: CALLS APIClient with paths aligned to backend `/api/v1` routes.
enum MediaVaultAPI {
    static func testConnection(baseURL: URL) async throws -> SetupStatusResponse {
        try await APIClient.shared.request("/setup/status", baseURL: baseURL)
    }

    static func registrationSetting(baseURL: URL) async throws -> RegistrationSettingResponse {
        try await APIClient.shared.request("/settings/registration", baseURL: baseURL)
    }

    static func login(baseURL: URL, email: String, password: String) async throws -> AuthResponse {
        try await APIClient.shared.request(
            "/auth/login",
            method: "POST",
            body: LoginRequest(email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), password: password),
            baseURL: baseURL
        )
    }

    static func register(baseURL: URL, email: String, password: String) async throws -> AuthResponse {
        try await APIClient.shared.request(
            "/auth/register",
            method: "POST",
            body: RegisterRequest(email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), password: password),
            baseURL: baseURL
        )
    }
}
