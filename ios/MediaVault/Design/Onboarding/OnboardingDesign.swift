import SwiftUI

// Human: Modern liquid-glass design system for the MediaVault onboarding flow.
// Agent: PROVIDES background, glass shell, inputs, buttons, and progress dots; FALLS BACK from iOS 26 glassEffect to ultraThinMaterial.

// MARK: - Background

// Human: Full-bleed colorful backdrop behind every onboarding screen.
// Agent: USES MeshGradient on iOS 18+; RENDERS layered radial gradients as fallback; gently drifts via TimelineView.
struct LiquidGlassBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { context in
                let drift = drift(at: context.date)
                meshLayer(drift: drift)
            }
            .ignoresSafeArea()

            // Specular highlight bloom — adds depth that Liquid Glass refracts.
            RadialGradient(
                colors: [Color.white.opacity(colorScheme == .dark ? 0.08 : 0.45), .clear],
                center: .init(x: 0.15, y: 0.1),
                startRadius: 0,
                endRadius: 320
            )
            .ignoresSafeArea()
            .blendMode(.plusLighter)
        }
    }

    private func drift(at date: Date) -> Double {
        let interval = date.timeIntervalSinceReferenceDate
        return interval.remainder(dividingBy: 24) / 24
    }

    @ViewBuilder
    private func meshLayer(drift: Double) -> some View {
        let lift = CGFloat(sin(drift * .pi * 2) * 0.06)
        let sway = CGFloat(cos(drift * .pi * 2) * 0.06)

        if #available(iOS 18.0, *) {
            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    .init(0, 0), .init(0.5 + Float(sway), 0), .init(1, 0),
                    .init(0, 0.5 + Float(lift)), .init(0.5, 0.5), .init(1, 0.5 - Float(lift)),
                    .init(0, 1), .init(0.5 - Float(sway), 1), .init(1, 1),
                ],
                colors: meshColors,
                smoothsColors: true
            )
        } else {
            ZStack {
                LinearGradient(colors: legacyGradient, startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(
                    colors: [Color.accentColor.opacity(0.35), .clear],
                    center: .init(x: 0.2 + sway, y: 0.15),
                    startRadius: 0,
                    endRadius: 480
                )
                .blendMode(.plusLighter)
                RadialGradient(
                    colors: [Color.purple.opacity(0.30), .clear],
                    center: .init(x: 0.8, y: 0.85 + lift),
                    startRadius: 0,
                    endRadius: 520
                )
                .blendMode(.plusLighter)
            }
        }
    }

    private var meshColors: [Color] {
        if colorScheme == .dark {
            return [
                Color(red: 0.05, green: 0.07, blue: 0.16),
                Color.accentColor.opacity(0.55),
                Color(red: 0.08, green: 0.05, blue: 0.22),
                Color(red: 0.07, green: 0.10, blue: 0.22),
                Color.accentColor.opacity(0.35),
                Color.indigo.opacity(0.55),
                Color(red: 0.04, green: 0.05, blue: 0.14),
                Color.purple.opacity(0.45),
                Color(red: 0.08, green: 0.06, blue: 0.20),
            ]
        }

        return [
            Color(red: 0.92, green: 0.96, blue: 1.0),
            Color.accentColor.opacity(0.30),
            Color(red: 0.95, green: 0.92, blue: 1.0),
            Color(red: 0.96, green: 0.98, blue: 1.0),
            Color.accentColor.opacity(0.18),
            Color.purple.opacity(0.22),
            Color.accentColor.opacity(0.22),
            Color(red: 0.97, green: 0.97, blue: 1.0),
            Color.indigo.opacity(0.18),
        ]
    }

    private var legacyGradient: [Color] {
        colorScheme == .dark
            ? [Color(red: 0.05, green: 0.07, blue: 0.16), Color(red: 0.10, green: 0.05, blue: 0.20)]
            : [Color(red: 0.95, green: 0.97, blue: 1.0), Color(red: 0.98, green: 0.95, blue: 1.0)]
    }
}

// MARK: - Glass primitives

// Human: View modifier that applies iOS 26 `.glassEffect` with a graceful material fallback.
// Agent: CHECKS #available iOS 26; APPLIES Glass with shape; FALLS BACK to ultraThinMaterial + rim border.
struct LiquidGlassSurface<S: InsettableShape>: ViewModifier {
    let shape: S
    var tint: Color?
    var interactive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.modifier(LiquidGlassiOS26<S>(shape: shape, tint: tint, interactive: interactive))
        } else {
            content
                .background(
                    shape.fill(.ultraThinMaterial)
                )
                .overlay(
                    shape.fill(tint?.opacity(0.18) ?? .clear)
                )
                .overlay(
                    shape.strokeBorder(Color.white.opacity(0.18), lineWidth: 0.75)
                )
                .shadow(color: Color.black.opacity(0.08), radius: 18, y: 10)
        }
    }
}

@available(iOS 26.0, *)
private struct LiquidGlassiOS26<S: InsettableShape>: ViewModifier {
    let shape: S
    var tint: Color?
    var interactive: Bool

    func body(content: Content) -> some View {
        let glass: Glass = {
            var base: Glass = .regular
            if let tint { base = base.tint(tint) }
            if interactive { base = base.interactive() }
            return base
        }()
        return content.glassEffect(glass, in: shape)
    }
}

extension View {
    // Human: Convenience for applying the project's liquid glass surface to any view.
    // Agent: WRAPS shape with LiquidGlassSurface modifier; uses iOS 26 glassEffect when available.
    func liquidGlass<S: InsettableShape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(LiquidGlassSurface(shape: shape, tint: tint, interactive: interactive))
    }
}

// MARK: - Screen shell

// Human: Standard layout for an onboarding step — background, scrollable content, sticky bottom bar.
// Agent: HOSTS LiquidGlassBackground; ANCHORS bottom actions; SHOWS optional step dots above home indicator.
struct LiquidGlassScreen<Content: View, Bottom: View>: View {
    var step: Int?
    var totalSteps: Int = OnboardingStep.allCases.count
    var contentTopPadding: CGFloat = 24
    @ViewBuilder var content: () -> Content
    @ViewBuilder var bottom: () -> Bottom

    var body: some View {
        ZStack(alignment: .bottom) {
            LiquidGlassBackground()

            ScrollView {
                VStack(spacing: 0) {
                    content()
                        .padding(.horizontal, 24)
                        .padding(.top, contentTopPadding)
                }
                .padding(.bottom, 220)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)

            VStack(spacing: 16) {
                bottom()
                    .padding(.horizontal, 24)

                if let step {
                    LiquidGlassStepDots(currentStep: step, totalSteps: totalSteps)
                }
            }
            .padding(.bottom, 24)
            .padding(.top, 16)
            .background(bottomGradient)
        }
    }

    private var bottomGradient: some View {
        LinearGradient(
            colors: [Color.clear, Color(.systemBackground).opacity(0.55), Color(.systemBackground).opacity(0.85)],
            startPoint: .top,
            endPoint: .bottom
        )
        .allowsHitTesting(false)
        .ignoresSafeArea(edges: .bottom)
    }
}

// MARK: - Form components

// Human: Glass capsule text field with a leading SF Symbol icon.
// Agent: BINDS text; SUPPORTS secure entry + visibility toggle; USES liquidGlass capsule background.
struct LiquidGlassField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String
    var isSecure: Bool = false
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType?
    var showPassword: Binding<Bool>?
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(isFocused ? Color.accentColor : .secondary)
                .frame(width: 22)
                .animation(.easeOut(duration: 0.2), value: isFocused)

            Group {
                if isSecure, showPassword?.wrappedValue != true {
                    SecureField(placeholder, text: $text)
                        .textContentType(textContentType)
                } else {
                    TextField(placeholder, text: $text)
                        .keyboardType(keyboardType)
                        .textContentType(textContentType)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .font(.body)
            .focused($isFocused)
            .foregroundStyle(.primary)

            if isSecure, let showPassword {
                Button {
                    showPassword.wrappedValue.toggle()
                } label: {
                    Image(systemName: showPassword.wrappedValue ? "eye.slash.fill" : "eye.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 22)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 58)
        .liquidGlass(in: Capsule(), interactive: false)
        .overlay(
            Capsule()
                .strokeBorder(isFocused ? Color.accentColor.opacity(0.55) : Color.clear, lineWidth: 1)
                .animation(.easeOut(duration: 0.2), value: isFocused)
        )
    }
}

// Human: Primary call-to-action button using `.buttonStyle(.glassProminent)` on iOS 26 with material fallback.
// Agent: SHOWS loading spinner; APPLIES accent tint via control's tint() so glass refracts the color.
struct LiquidGlassPrimaryButton: View {
    let title: String
    var isLoading: Bool = false
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        if #available(iOS 26.0, *) {
            iOS26Button
        } else {
            fallbackButton
        }
    }

    @available(iOS 26.0, *)
    private var iOS26Button: some View {
        Button(action: action) {
            content
        }
        .buttonStyle(.glassProminent)
        .tint(Color.accentColor)
        .controlSize(.extraLarge)
        .buttonBorderShape(.capsule)
        .disabled(!isEnabled || isLoading)
        .opacity(isEnabled ? 1 : 0.6)
    }

    private var fallbackButton: some View {
        Button(action: action) {
            content
                .frame(maxWidth: .infinity)
                .frame(height: 58)
                .background(Color.accentColor.opacity(isEnabled ? 1 : 0.45), in: Capsule())
                .overlay(
                    Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
                )
                .shadow(color: Color.accentColor.opacity(isEnabled ? 0.45 : 0), radius: 22, y: 12)
        }
        .disabled(!isEnabled || isLoading)
        .buttonStyle(.plain)
    }

    private var content: some View {
        HStack(spacing: 10) {
            if isLoading {
                ProgressView()
                    .tint(.white)
            }
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 24)
        .padding(.vertical, 8)
    }
}

// Human: Small floating glass chip used for status/branding above titles.
// Agent: RENDERS leading symbol + text inside a liquidGlass capsule.
struct LiquidGlassChip: View {
    let symbol: String?
    let text: String
    var symbolColor: Color = .green

    var body: some View {
        HStack(spacing: 8) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(symbolColor)
            }
            Text(text)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .liquidGlass(in: Capsule())
    }
}

// Human: Inline checkbox-style toggle for "remember me" rows.
// Agent: TOGGLES bool; RENDERS small accent square + label.
struct LiquidGlassCheckbox: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(isOn ? Color.accentColor : Color.secondary.opacity(0.35), lineWidth: 1.5)
                        .frame(width: 20, height: 20)
                    if isOn {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(Color.accentColor)
                            .frame(width: 12, height: 12)
                    }
                }
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

// Human: Progress dots wrapped in a glass capsule, anchored above the home indicator.
// Agent: HIGHLIGHTS the current step with an elongated accent dot.
struct LiquidGlassStepDots: View {
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1 ... totalSteps, id: \.self) { step in
                Capsule()
                    .fill(step == currentStep ? Color.accentColor : Color.primary.opacity(0.18))
                    .frame(width: step == currentStep ? 22 : 6, height: 6)
                    .animation(.spring(response: 0.35), value: currentStep)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .liquidGlass(in: Capsule())
        .accessibilityLabel("Step \(currentStep) of \(totalSteps)")
    }
}

// Human: Inline "Don't have an account? Sign up" style footer below primary buttons.
// Agent: CALLS linkAction when accent segment is tapped.
struct LiquidGlassInlineLink: View {
    let prefix: String
    let linkTitle: String
    let linkAction: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(prefix)
                .foregroundStyle(.secondary)
            Button(linkTitle, action: linkAction)
                .fontWeight(.semibold)
                .foregroundStyle(Color.accentColor)
        }
        .font(.subheadline)
    }
}

// Human: Bold display title with optional supportive subtitle.
// Agent: RENDERS large bold heading; supports left-aligned hierarchy on form screens.
struct LiquidGlassTitle: View {
    let title: String
    var subtitle: String?
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 8) {
            Text(title)
                .font(.system(size: 40, weight: .bold, design: .default))
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: textAlignment)

            if let subtitle {
                Text(subtitle)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: textAlignment)
            }
        }
    }

    private var textAlignment: Alignment {
        switch alignment {
        case .leading: .leading
        case .trailing: .trailing
        default: .center
        }
    }
}
