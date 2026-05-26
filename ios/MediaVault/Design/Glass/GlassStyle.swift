import SwiftUI

// Human: Shared frosted-glass styling for onboarding and future screens.
// Agent: APPLIES Material backgrounds + hairline borders; FALLBACK for iOS 17+.
struct OnboardingBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color.accentColor.opacity(0.22),
                    Color.blue.opacity(0.12),
                    Color(.systemBackground),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(Color.accentColor.opacity(0.18))
                .frame(width: 280, height: 280)
                .blur(radius: 60)
                .offset(x: -120, y: -260)

            Circle()
                .fill(Color.cyan.opacity(0.14))
                .frame(width: 220, height: 220)
                .blur(radius: 50)
                .offset(x: 140, y: 120)
        }
    }
}

// Human: Floating glass card container for onboarding content blocks.
// Agent: WRAPS child views in Material with rounded rect stroke overlay.
struct GlassCard<Content: View>: View {
    var accent: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.ultraThinMaterial)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(
                        accent ? Color.accentColor.opacity(0.45) : Color.primary.opacity(0.08),
                        lineWidth: 1
                    )
            }
    }
}

// Human: Secondary pill button for non-primary onboarding actions.
// Agent: RENDERS material-backed capsule for test connection and similar actions.
struct GlassSecondaryButton: View {
    let title: String
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                }
                Text(title)
                    .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(.regularMaterial, in: Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            }
        }
        .disabled(!isEnabled || isLoading)
        .buttonStyle(.plain)
    }
}

// Human: Primary pill CTA styled for glass onboarding screens.
// Agent: RENDERS full-width button; DISABLED state lowers opacity.
struct GlassPrimaryButton: View {
    let title: String
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
                Text(title)
                    .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Color.accentColor.opacity(isEnabled ? 1 : 0.45), in: Capsule())
            .foregroundStyle(.white)
        }
        .disabled(!isEnabled || isLoading)
        .buttonStyle(.plain)
    }
}

// Human: Secondary text-style action below primary CTAs.
// Agent: PLAIN button with accent tint for skip/ghost actions.
struct GlassGhostButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.tint)
            .buttonStyle(.plain)
    }
}

// Human: Material-backed text field row for onboarding forms.
// Agent: BINDS optional external focus; SHOWS label above field capsule.
struct GlassTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var isSecure: Bool = false
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType?
    var autocapitalization: TextInputAutocapitalization = .never

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            Group {
                if isSecure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                        .keyboardType(keyboardType)
                        .textContentType(textContentType)
                        .textInputAutocapitalization(autocapitalization)
                        .autocorrectionDisabled()
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            }
        }
    }
}

// Human: Step progress dots shown at the bottom of onboarding screens.
// Agent: DISPLAYS current step index out of total onboarding steps.
struct OnboardingProgressIndicator: View {
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1 ... totalSteps, id: \.self) { step in
                Capsule()
                    .fill(step == currentStep ? Color.accentColor : Color.secondary.opacity(0.25))
                    .frame(width: step == currentStep ? 18 : 6, height: 6)
                    .animation(.spring(response: 0.35), value: currentStep)
            }
        }
        .accessibilityLabel("Step \(currentStep) of \(totalSteps)")
    }
}

// Human: Large rounded icon tile used on welcome and ready screens.
// Agent: DISPLAYS SF Symbol inside material-backed rounded square.
struct OnboardingHeroIcon: View {
    let systemName: String

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 30, weight: .semibold))
            .foregroundStyle(.tint)
            .frame(width: 76, height: 76)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            }
    }
}

// Human: Vertically centered scroll layout for form-heavy onboarding steps.
// Agent: CENTERS content in remaining space above footer; DISMISSES keyboard on scroll.
struct OnboardingCenteredScrollLayout<Content: View>: View {
    let step: Int
    let totalSteps: Int
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 24)
                        content()
                        Spacer(minLength: 24)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geometry.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
            }

            VStack(spacing: 12) {
                OnboardingProgressIndicator(currentStep: step, totalSteps: totalSteps)
            }
            .padding(.top, 12)
            .padding(.bottom, 20)
            .background(.ultraThinMaterial)
        }
    }
}

// Human: Compact server badge shown on the sign-in form header.
// Agent: DISPLAYS connected host; CALLS onChangeServer when user taps Change.
struct OnboardingServerBadge: View {
    let host: String
    let onChangeServer: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption)

            Text(host)
                .font(.caption.monospaced())
                .lineLimit(1)

            Spacer(minLength: 0)

            Button("Change", action: onChangeServer)
                .font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        }
    }
}

// Human: Shared onboarding screen chrome — title, subtitle, progress, and actions.
// Agent: SCROLLS content; ANCHORS footer actions above home indicator safe area.
struct OnboardingScreenLayout<Content: View, Footer: View>: View {
    let title: String
    let subtitle: String
    let step: Int
    let totalSteps: Int
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 20) {
                    content()
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }

            VStack(spacing: 12) {
                VStack(spacing: 6) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                OnboardingProgressIndicator(currentStep: step, totalSteps: totalSteps)

                VStack(spacing: 10) {
                    footer()
                }
                .padding(.horizontal, 20)
            }
            .padding(.top, 12)
            .padding(.bottom, 20)
            .background(.ultraThinMaterial)
        }
    }
}
