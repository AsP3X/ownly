import SwiftUI

// Human: Email/password sign-in on the gradient auth stack.
// Agent: CALLS AuthService.login; WRITES AuthTokenStorage + UserProfileStorage; CALLS onSuccess.
struct LoginView: View {
    @Environment(\.appState) private var appState
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    var onSuccess: () -> Void = {}
    var onBack: () -> Void = {}

    enum Field { case email, password }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [OwnlyColors.primary950, OwnlyColors.neutral950],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OwnlyColors.neutral100)
                            .frame(width: 44, height: 44)
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                Spacer(minLength: 0)

                VStack(spacing: 24) {
                    Text("Sign in")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(OwnlyColors.textOnGradient)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    formFields
                }
                .padding(.horizontal, 24)

                Spacer(minLength: 0)

                VStack(spacing: 14) {
                    Button(action: submit) {
                        Group {
                            if isLoading {
                                OwnlySpinner(tint: .white)
                            } else {
                                Text("Sign in")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(OwnlyColors.textOnGradient)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                    }
                    .glassButtonPrimary()
                    .disabled(isLoading || email.isEmpty || password.isEmpty)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
                .padding(.top, 24)
            }
        }
    }

    @ViewBuilder
    private var formFields: some View {
        VStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Email")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(OwnlyColors.neutral400)
                TextField("you@example.com", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .email)
                    .foregroundStyle(OwnlyColors.neutral100)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .glassField(cornerRadius: 10)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Password")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(OwnlyColors.neutral400)
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .focused($focusedField, equals: .password)
                    .foregroundStyle(OwnlyColors.neutral100)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .glassField(cornerRadius: 10)
            }

            if let error = errorMessage {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(OwnlyColors.error500)
                    Text(error)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OwnlyColors.error500)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(OwnlyColors.error50.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(OwnlyColors.error500.opacity(0.35), lineWidth: 1)
                )
            }
        }
    }

    private func submit() {
        errorMessage = nil
        focusedField = nil

        if email.isEmpty || password.isEmpty {
            errorMessage = "Enter your email and password."
            return
        }
        if appState.config.apiBaseURL == nil {
            errorMessage = "Configure your server first."
            return
        }

        isLoading = true
        Task { @MainActor in
            defer { isLoading = false }
            let result = await AuthService.login(email: email, password: password, config: appState.config)
            switch result {
            case .success((let token, let user)):
                AuthTokenStorage.save(token: token)
                UserProfileStorage.email = user.email
                onSuccess()
            case .failure(let failure):
                errorMessage = message(for: failure)
            }
        }
    }

    private func message(for failure: AuthLoginFailure) -> String {
        switch failure {
        case .noServerURL:
            return "Configure your server first."
        case .invalidCredentials:
            return "Invalid email or password."
        case .serverError(let message):
            return message
        case .networkError(let description):
            return description
        }
    }
}

#Preview {
    LoginView()
        .environment(\.appState, AppState())
}
