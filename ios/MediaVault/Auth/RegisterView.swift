import SwiftUI

// Human: Public registration screen when the server allows it.
// Agent: CALLS AuthService.register; success returns to login via onSuccess.
struct RegisterView: View {
    @Environment(\.appState) private var appState
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    var onSuccess: () -> Void = {}
    var onBack: () -> Void = {}

    enum Field { case email, password, confirmPassword }

    private var isFormValid: Bool {
        !email.isEmpty && password.count >= 8 && password == confirmPassword
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [MediaVaultColors.primary950, MediaVaultColors.neutral950],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Button(action: onBack) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(MediaVaultColors.neutral100)
                            .frame(width: 44, height: 44)
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                Spacer(minLength: 0)

                VStack(spacing: 24) {
                    Text("Create account")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(MediaVaultColors.textOnGradient)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    formFields
                }
                .padding(.horizontal, 24)

                Spacer(minLength: 0)

                VStack(spacing: 14) {
                    Button(action: submit) {
                        Group {
                            if isLoading {
                                MediaVaultSpinner(tint: .white)
                            } else {
                                Text("Create account")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(MediaVaultColors.textOnGradient)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                    }
                    .glassButtonPrimary()
                    .disabled(isLoading || !isFormValid)
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
            field(title: "Email", text: $email, field: .email, secure: false)
            field(title: "Password", text: $password, field: .password, secure: true)
            field(title: "Confirm password", text: $confirmPassword, field: .confirmPassword, secure: true)

            if let error = errorMessage {
                Text(error)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(MediaVaultColors.error500)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func field(title: String, text: Binding<String>, field: Field, secure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(MediaVaultColors.neutral400)
            Group {
                if secure {
                    SecureField(title, text: text)
                } else {
                    TextField(title, text: text)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .focused($focusedField, equals: field)
            .foregroundStyle(MediaVaultColors.neutral100)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .glassField(cornerRadius: 10)
        }
    }

    private func submit() {
        errorMessage = nil
        focusedField = nil

        guard password == confirmPassword else {
            errorMessage = "Passwords do not match."
            return
        }
        guard appState.config.apiBaseURL != nil else {
            errorMessage = "Configure your server first."
            return
        }

        isLoading = true
        Task { @MainActor in
            defer { isLoading = false }
            let result = await AuthService.register(email: email, password: password, config: appState.config)
            switch result {
            case .success:
                onSuccess()
            case .failure(let failure):
                errorMessage = message(for: failure)
            }
        }
    }

    private func message(for failure: AuthRegisterFailure) -> String {
        switch failure {
        case .noServerURL:
            return "Configure your server first."
        case .serverError(let message):
            return message
        case .networkError(let description):
            return description
        }
    }
}

#Preview {
    RegisterView()
        .environment(\.appState, AppState())
}
