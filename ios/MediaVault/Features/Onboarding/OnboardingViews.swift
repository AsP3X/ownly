import SwiftUI

// Human: Individual onboarding step screens using the modern Liquid Glass design system.
// Agent: BINDS OnboardingViewModel; USES LiquidGlass components on top of LiquidGlassBackground.

// MARK: - Welcome

struct OnboardingWelcomeView: View {
    let model: OnboardingViewModel

    var body: some View {
        LiquidGlassScreen(
            step: OnboardingStep.welcome.rawValue,
            contentTopPadding: 40
        ) {
            VStack(alignment: .leading, spacing: 28) {
                LiquidGlassChip(symbol: "sparkles", text: "MediaVault", symbolColor: .accentColor)

                Spacer(minLength: 16)

                LiquidGlassTitle(
                    title: "Your media, beautifully yours.",
                    subtitle: "Private storage, streaming, and sharing — all from your own MediaVault instance.",
                    alignment: .leading
                )

                FeatureBadgeStack()

                Spacer(minLength: 60)
            }
        } bottom: {
            VStack(spacing: 12) {
                LiquidGlassPrimaryButton(title: "Get started") {
                    model.goToNextStep()
                }

                Button("I already have an account") {
                    model.skipToConnect()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct FeatureBadgeStack: View {
    private let items: [(symbol: String, title: String, detail: String)] = [
        ("lock.shield.fill", "Private by design", "End-to-end on your own instance."),
        ("play.rectangle.fill", "Stream anywhere", "Encrypted HLS playback on device."),
        ("link.circle.fill", "Share securely", "Time-limited links you control."),
    ]

    var body: some View {
        VStack(spacing: 12) {
            ForEach(items, id: \.title) { item in
                HStack(spacing: 14) {
                    Image(systemName: item.symbol)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 32, height: 32)
                        .liquidGlass(in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Text(item.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .liquidGlass(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }
}

// MARK: - Connect

struct OnboardingConnectView: View {
    let model: OnboardingViewModel

    var body: some View {
        LiquidGlassScreen(
            step: OnboardingStep.connect.rawValue,
            contentTopPadding: 32
        ) {
            VStack(alignment: .leading, spacing: 24) {
                LiquidGlassChip(symbol: "antenna.radiowaves.left.and.right", text: "Connect server", symbolColor: .accentColor)

                LiquidGlassTitle(
                    title: "Connect to your server",
                    subtitle: "Paste your MediaVault API URL — usually shown in the admin panel.",
                    alignment: .leading
                )

                LiquidGlassField(
                    icon: "link",
                    placeholder: "https://vault.example.com",
                    text: Binding(
                        get: { model.serverURLText },
                        set: {
                            model.serverURLText = $0
                            model.isConnectionVerified = false
                        }
                    ),
                    keyboardType: .URL,
                    textContentType: .URL
                )

                HStack {
                    Button {
                        model.pasteFromClipboard()
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)

                    Spacer()

                    Button {
                        Task { await model.testConnection() }
                    } label: {
                        HStack(spacing: 8) {
                            if model.isTestingConnection {
                                ProgressView()
                            } else {
                                Image(systemName: "wifi")
                            }
                            Text(model.isTestingConnection ? "Testing…" : "Test connection")
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                    .disabled(model.serverURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isTestingConnection)
                }

                if let message = model.connectionMessage {
                    HStack(spacing: 10) {
                        Image(systemName: model.connectionIsError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(model.connectionIsError ? .orange : .green)
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.primary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .liquidGlass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        } bottom: {
            LiquidGlassPrimaryButton(
                title: "Continue",
                isEnabled: model.isConnectionVerified
            ) {
                model.continueFromConnect()
            }
        }
    }
}

// MARK: - Sign in

struct OnboardingSignInView: View {
    let model: OnboardingViewModel
    @State private var showPassword = false
    @State private var showConfirmPassword = false
    @State private var rememberMe = true

    var body: some View {
        LiquidGlassScreen(
            step: OnboardingStep.signIn.rawValue,
            contentTopPadding: 28
        ) {
            VStack(alignment: .leading, spacing: 28) {
                serverChip

                VStack(alignment: .leading, spacing: 8) {
                    Text(model.isCreatingAccount ? "Create account" : "Welcome back")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(.primary)

                    Text(model.isCreatingAccount
                        ? "Set up a new account on your MediaVault instance."
                        : "Sign in to access your media on this device.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 14) {
                    LiquidGlassField(
                        icon: "envelope",
                        placeholder: "Email",
                        text: Binding(get: { model.email }, set: { model.email = $0 }),
                        keyboardType: .emailAddress,
                        textContentType: .username
                    )

                    LiquidGlassField(
                        icon: "lock",
                        placeholder: "Password",
                        text: Binding(get: { model.password }, set: { model.password = $0 }),
                        isSecure: true,
                        textContentType: model.isCreatingAccount ? .newPassword : .password,
                        showPassword: $showPassword
                    )

                    if model.isCreatingAccount {
                        LiquidGlassField(
                            icon: "checkmark.shield",
                            placeholder: "Confirm password",
                            text: Binding(get: { model.confirmPassword }, set: { model.confirmPassword = $0 }),
                            isSecure: true,
                            textContentType: .newPassword,
                            showPassword: $showConfirmPassword
                        )
                    }
                }

                if !model.isCreatingAccount {
                    LiquidGlassCheckbox(label: "Remember me on this device", isOn: $rememberMe)
                }

                if let authError = model.authError {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text(authError)
                            .font(.footnote)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .liquidGlass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        } bottom: {
            VStack(spacing: 14) {
                LiquidGlassPrimaryButton(
                    title: model.isCreatingAccount ? "Create account" : "Sign in",
                    isLoading: model.isAuthenticating || model.isCreatingAccount
                ) {
                    Task {
                        if model.isCreatingAccount {
                            await model.createAccount()
                        } else {
                            await model.signIn()
                        }
                    }
                }

                if model.allowRegistration {
                    LiquidGlassInlineLink(
                        prefix: model.isCreatingAccount ? "Already have an account?" : "Don't have an account?",
                        linkTitle: model.isCreatingAccount ? "Sign in" : "Sign up"
                    ) {
                        model.isCreatingAccount.toggle()
                        model.authError = nil
                        model.confirmPassword = ""
                    }
                }
            }
        }
        .task {
            await model.loadRegistrationSetting()
        }
    }

    // Compact server status row with change-server affordance.
    private var serverChip: some View {
        HStack(spacing: 10) {
            LiquidGlassChip(
                symbol: "checkmark.circle.fill",
                text: ServerConfiguration.shared.displayHost,
                symbolColor: .green
            )
            Spacer()
            Button("Change") {
                model.changeServer()
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.accentColor)
        }
    }
}

// MARK: - Permissions

struct OnboardingPermissionsView: View {
    let model: OnboardingViewModel

    var body: some View {
        LiquidGlassScreen(
            step: OnboardingStep.permissions.rawValue,
            contentTopPadding: 32
        ) {
            VStack(alignment: .leading, spacing: 28) {
                LiquidGlassChip(symbol: "checkmark.shield.fill", text: "Almost there", symbolColor: .accentColor)

                LiquidGlassTitle(
                    title: "Allow access",
                    subtitle: "Optional permissions help uploads and downloads run smoothly.",
                    alignment: .leading
                )

                VStack(spacing: 14) {
                    permissionRow(
                        symbol: "photo.on.rectangle.angled",
                        title: "Photos",
                        detail: "Upload images and videos from your camera roll."
                    )
                    permissionRow(
                        symbol: "arrow.down.circle.fill",
                        title: "Background downloads",
                        detail: "Continue transfers when you leave the app."
                    )
                }
            }
        } bottom: {
            VStack(spacing: 12) {
                LiquidGlassPrimaryButton(
                    title: "Allow access",
                    isLoading: model.isRequestingPhotos
                ) {
                    Task { await model.requestPhotosAccess() }
                }

                Button("Not now") {
                    model.skipPermissions()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func permissionRow(symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 36, height: 36)
                .liquidGlass(in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .liquidGlass(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

// MARK: - Highlights

struct OnboardingHighlightsView: View {
    let model: OnboardingViewModel

    private var slide: HighlightSlide {
        model.highlightSlides[model.highlightIndex]
    }

    var body: some View {
        LiquidGlassScreen(
            step: OnboardingStep.highlights.rawValue,
            contentTopPadding: 28
        ) {
            VStack(alignment: .leading, spacing: 24) {
                LiquidGlassChip(symbol: "sparkles", text: "Quick tour", symbolColor: .accentColor)

                Image(systemName: slide.symbol)
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(maxWidth: .infinity)
                    .frame(height: 180)
                    .liquidGlass(in: RoundedRectangle(cornerRadius: 28, style: .continuous), tint: Color.accentColor.opacity(0.2))

                VStack(alignment: .leading, spacing: 8) {
                    Text(slide.title)
                        .font(.system(size: 30, weight: .bold))
                    Text(slide.detail)
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 6) {
                    ForEach(Array(model.highlightSlides.enumerated()), id: \.offset) { index, _ in
                        Capsule()
                            .fill(index == model.highlightIndex ? Color.accentColor : Color.primary.opacity(0.2))
                            .frame(width: index == model.highlightIndex ? 22 : 6, height: 6)
                            .animation(.spring(response: 0.35), value: model.highlightIndex)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        } bottom: {
            VStack(spacing: 12) {
                LiquidGlassPrimaryButton(
                    title: model.highlightIndex < model.highlightSlides.count - 1 ? "Next" : "Finish tour"
                ) {
                    model.nextHighlight()
                }

                Button("Skip tour") {
                    model.skipTour()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Ready

struct OnboardingReadyView: View {
    let model: OnboardingViewModel

    var body: some View {
        LiquidGlassScreen(
            step: OnboardingStep.ready.rawValue,
            contentTopPadding: 80
        ) {
            VStack(spacing: 28) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 80, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .padding(28)
                    .liquidGlass(in: Circle(), tint: Color.accentColor.opacity(0.25))

                VStack(spacing: 10) {
                    Text("You're all set")
                        .font(.system(size: 34, weight: .bold))

                    Text("Your drive is ready. Pull to refresh anytime your library updates.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
        } bottom: {
            LiquidGlassPrimaryButton(title: "Open my drive") {
                model.finishOnboarding()
            }
        }
    }
}
