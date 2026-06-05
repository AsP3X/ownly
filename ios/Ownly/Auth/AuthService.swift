import Foundation

// Human: Password auth client aligned with Ownly `/api/v1` routes and AppError JSON envelope.
// Agent: STATIC login/register/registrationSetting; BUILDS URLs from ServerConfig.apiBaseURL; PARSES AuthResponse and APIErrorBody.
enum SessionValidationResult: Equatable, Sendable {
    case valid(user: AuthUser)
    case unauthorized
    case unreachable(message: String)
}

enum AuthService {
    private static let timeout: TimeInterval = 20

    /// Confirms the stored bearer token against `GET /api/v1/me` after connectivity returns.
    static func validateSession(config: ServerConfig) async -> SessionValidationResult {
        guard let token = AuthTokenStorage.getToken(), !token.isEmpty else {
            return .unauthorized
        }
        guard let url = config.requestURL(path: "/me") else {
            return .unreachable(message: "Server URL is not configured.")
        }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        AppIdentity.apply(to: &request)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .unreachable(message: "Invalid response")
            }
            if http.statusCode == 401 {
                return .unauthorized
            }
            guard (200 ..< 300).contains(http.statusCode) else {
                let message = parseErrorMessage(from: data) ?? "Session check failed."
                return .unreachable(message: message)
            }
            let user = try OwnlyJSON.makeDecoder().decode(AuthUser.self, from: data)
            return .valid(user: user)
        } catch {
            return .unreachable(message: error.localizedDescription)
        }
    }

    static func registrationSetting(config: ServerConfig) async -> Bool {
        guard let url = config.requestURL(path: "/settings/registration") else { return false }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        AppIdentity.apply(to: &request)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
                return false
            }
            let decoded = try JSONDecoder().decode(RegistrationSettingResponse.self, from: data)
            return decoded.allowPublicRegistration
        } catch {
            return false
        }
    }

    static func login(email: String, password: String, config: ServerConfig) async -> Result<(String, AuthUser), AuthLoginFailure> {
        guard let url = config.requestURL(path: "/auth/login") else {
            return .failure(.noServerURL)
        }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        AppIdentity.apply(to: &request)

        let payload = LoginRequest(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            password: password
        )

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.networkError(description: "Invalid response"))
            }

            if http.statusCode == 401 {
                return .failure(.invalidCredentials)
            }

            guard (200 ..< 300).contains(http.statusCode) else {
                return .failure(.serverError(message: parseErrorMessage(from: data) ?? "Login failed."))
            }

            let decoded = try JSONDecoder().decode(AuthResponse.self, from: data)
            guard let token = decoded.token, !token.isEmpty else {
                return .failure(.serverError(message: "Account pending activation."))
            }
            return .success((token, decoded.user))
        } catch {
            return .failure(.networkError(description: error.localizedDescription))
        }
    }

    static func register(email: String, password: String, config: ServerConfig) async -> Result<Void, AuthRegisterFailure> {
        guard let url = config.requestURL(path: "/auth/register") else {
            return .failure(.noServerURL)
        }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        AppIdentity.apply(to: &request)

        let payload = RegisterRequest(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            password: password
        )

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.networkError(description: "Invalid response"))
            }

            guard (200 ..< 300).contains(http.statusCode) else {
                return .failure(.serverError(message: parseErrorMessage(from: data) ?? "Registration failed."))
            }
            return .success(())
        } catch {
            return .failure(.networkError(description: error.localizedDescription))
        }
    }

    private static func parseErrorMessage(from data: Data) -> String? {
        guard let body = try? JSONDecoder().decode(APIErrorBody.self, from: data) else { return nil }
        return body.error.message
    }
}
