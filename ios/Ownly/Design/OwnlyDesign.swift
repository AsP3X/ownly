//
//  OwnlyDesign.swift
//  Ownly
//
//  Liquid glass only. Enterprise-ready. No solid fills on UI chrome.
//  Adaptive: supports both dark and light appearance.
//

import os
import SwiftUI

// Human: Shared “liquid glass” visuals, brand colors, motion, favicon loading, and small reusable SwiftUI widgets for the whole app.
// Agent: OwnlyColors adaptive UIColor; View glassPanel glassButtonPrimary glassField glassCard iOS26 glassEffect fallback material; elasticSlide; OwnlySpinner; FaviconImageView URLSession no-cache Bearer; Color hex extension.

// MARK: - View switch animations

// Human: Spring used when swapping major screens (auth stack, pushes) so transitions feel elastic, not flat.
// Agent: STATIC Animation.elasticSlide spring response 0.48 dampingFraction 0.55; USED auth flow navigation transitions.
extension Animation {
    /// Elastic slide used for view switches (auth flow, navigation push/pop).
    /// Spring with visible overshoot/bounce (low damping) for an elastic feel.
    static let elasticSlide = Animation.spring(response: 0.48, dampingFraction: 0.55)
}

// MARK: - Enterprise palette (adaptive dark/light)

// Human: Canonical blues, neutrals, semantic reds/greens/yellows, and glass stroke/fill tokens that track light vs dark mode.
// Agent: ENUM OwnlyColors static lets; READS UITraitCollection userInterfaceStyle; EXPORTS primary neutral semantic glassStroke divider textOnGradient; CONSUMED across SwiftUI chrome.
enum OwnlyColors {

    // MARK: Primary – brand blues (same in both modes)

    static let primary400 = Color(red: 96/255, green: 165/255, blue: 250/255)
    static let primary500 = Color(red: 59/255, green: 130/255, blue: 246/255)
    static let primary600 = Color(red: 37/255, green: 99/255, blue: 235/255)
    static let primary700 = Color(red: 29/255, green: 78/255, blue: 216/255)
    static let primary800 = Color(red: 30/255, green: 64/255, blue: 175/255)
    static let primary900 = Color(red: 30/255, green: 58/255, blue: 138/255)

    // MARK: Background gradient endpoints (adaptive)

    /// Gradient start: deep navy (dark) → soft indigo wash (light)
    static let primary950 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 23/255, green: 37/255, blue: 84/255, alpha: 1)
            : UIColor(red: 238/255, green: 242/255, blue: 255/255, alpha: 1)
    })

    /// Gradient end: near-black (dark) → warm off-white (light)
    static let neutral950 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 12/255, green: 10/255, blue: 9/255, alpha: 1)
            : UIColor(red: 250/255, green: 250/255, blue: 249/255, alpha: 1)
    })

    // MARK: Neutrals – text and surfaces (adaptive: reversed in light mode)

    /// Heading text: near-white (dark) → near-black (light)
    static let neutral100 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 245/255, green: 245/255, blue: 244/255, alpha: 1)
            : UIColor(red: 28/255, green: 25/255, blue: 23/255, alpha: 1)
    })

    /// Secondary text: warm light gray (dark) → warm dark gray (light)
    static let neutral200 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 231/255, green: 229/255, blue: 228/255, alpha: 1)
            : UIColor(red: 41/255, green: 37/255, blue: 36/255, alpha: 1)
    })

    /// Body text: medium-light (dark) → medium-dark (light)
    static let neutral400 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 168/255, green: 162/255, blue: 158/255, alpha: 1)
            : UIColor(red: 87/255, green: 83/255, blue: 78/255, alpha: 1)
    })

    /// Subtle text / section labels: stays mid-tone in both modes
    static let neutral500 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 120/255, green: 113/255, blue: 108/255, alpha: 1)
            : UIColor(red: 120/255, green: 113/255, blue: 108/255, alpha: 1)
    })

    /// Surface accent (dark) → lighter surface (light)
    static let neutral600 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 87/255, green: 83/255, blue: 78/255, alpha: 1)
            : UIColor(red: 168/255, green: 162/255, blue: 158/255, alpha: 1)
    })

    /// Deep surface (dark) → soft surface (light)
    static let neutral700 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 68/255, green: 64/255, blue: 60/255, alpha: 1)
            : UIColor(red: 214/255, green: 211/255, blue: 209/255, alpha: 1)
    })

    /// Near-black surface (dark) → light surface (light)
    static let neutral800 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 41/255, green: 37/255, blue: 36/255, alpha: 1)
            : UIColor(red: 231/255, green: 229/255, blue: 228/255, alpha: 1)
    })

    /// Deepest surface (dark) → lightest surface (light)
    static let neutral900 = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor(red: 28/255, green: 25/255, blue: 23/255, alpha: 1)
            : UIColor(red: 245/255, green: 245/255, blue: 244/255, alpha: 1)
    })

    // MARK: Semantic (health status, alerts – same in both modes)

    static let error50  = Color(red: 254/255, green: 242/255, blue: 242/255)
    static let error500 = Color(red: 239/255, green: 68/255, blue: 68/255)
    static let error700 = Color(red: 185/255, green: 28/255, blue: 28/255)
    static let success500 = Color(red: 34/255, green: 197/255, blue: 94/255)
    static let success400 = Color(red: 74/255, green: 222/255, blue: 128/255)
    static let warning500 = Color(red: 234/255, green: 179/255, blue: 8/255)
    static let warning400 = Color(red: 250/255, green: 204/255, blue: 21/255)

    // MARK: Adaptive helpers for glass chrome and dividers

    /// Bold text on gradient: white (dark) → near-black (light)
    static let textOnGradient = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor.white
            : UIColor(red: 28/255, green: 25/255, blue: 23/255, alpha: 1)
    })

    /// Stroke around glass panels
    static let glassStroke = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.22)
            : UIColor.black.withAlphaComponent(0.08)
    })

    /// Subtle stroke for cards and rows
    static let glassStrokeSubtle = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.12)
            : UIColor.black.withAlphaComponent(0.06)
    })

    /// Subtle fill for glass cards
    static let glassFillSubtle = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.04)
            : UIColor.black.withAlphaComponent(0.03)
    })

    /// Selected / highlighted fill for glass cards
    static let glassFillHighlight = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.08)
            : UIColor.black.withAlphaComponent(0.05)
    })

    /// Divider line between rows
    static let divider = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.12)
            : UIColor.black.withAlphaComponent(0.08)
    })
}

// MARK: - Liquid glass modifiers (adaptive strokes & tints)

private struct GlassPanelModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    var cornerRadius: CGFloat
    var tint: Color?
    var tintOpacity: Double

    @ViewBuilder
    func body(content: Content) -> some View {
        let effectTint = (tint ?? OwnlyColors.primary500).opacity(tintOpacity)
        if #available(iOS 26.0, *) {
            content
                .glassEffect(
                    .regular.tint(effectTint),
                    in: RoundedRectangle(cornerRadius: cornerRadius)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(OwnlyColors.glassStroke, lineWidth: 1)
                )
        } else {
            content
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(OwnlyColors.glassStroke, lineWidth: 1)
                )
        }
    }
}

private struct GlassButtonPrimaryModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    var cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(
                    .regular.tint(OwnlyColors.primary500.opacity(0.6)),
                    in: RoundedRectangle(cornerRadius: cornerRadius)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(Color.white.opacity(colorScheme == .dark ? 0.4 : 0.2), lineWidth: 1)
                )
        } else {
            content
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                .background(
                    OwnlyColors.primary600.opacity(colorScheme == .dark ? 0.5 : 0.6),
                    in: RoundedRectangle(cornerRadius: cornerRadius)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(Color.white.opacity(colorScheme == .dark ? 0.4 : 0.2), lineWidth: 1)
                )
        }
    }
}

private struct GlassButtonSecondaryModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    var cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        let tintColor: Color = colorScheme == .dark ? .white.opacity(0.12) : .black.opacity(0.04)
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.clear.tint(tintColor), in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(OwnlyColors.primary400.opacity(0.7), lineWidth: 1.5)
                )
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(OwnlyColors.primary400.opacity(0.7), lineWidth: 1.5)
                )
        }
    }
}

private struct GlassFieldModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    var cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        let tintColor: Color = colorScheme == .dark ? .white.opacity(0.06) : .black.opacity(0.03)
        let strokeColor: Color = colorScheme == .dark ? .white.opacity(0.18) : .black.opacity(0.08)
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.clear.tint(tintColor), in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(strokeColor, lineWidth: 1)
                )
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(strokeColor, lineWidth: 1)
                )
        }
    }
}

// Human: View modifiers that wrap content in glass materials (iOS 26 `glassEffect` when available, thin/ultraThinMaterial fallback).
// Agent: extension View glassPanel glassButtonPrimary glassButtonSecondary glassField glassCard; USES Glass*Modifier @Environment colorScheme; iOS 26 API gated #available.
extension View {
    /// Pure liquid glass panel. Translucent only; optional minimal tint.
    func glassPanel(cornerRadius: CGFloat = 24, tint: Color? = nil, tintOpacity: Double = 0.06) -> some View {
        modifier(GlassPanelModifier(cornerRadius: cornerRadius, tint: tint, tintOpacity: tintOpacity))
    }

    /// Primary CTA: glass with blue tint for clear visibility.
    func glassButtonPrimary(cornerRadius: CGFloat = 14) -> some View {
        modifier(GlassButtonPrimaryModifier(cornerRadius: cornerRadius))
    }

    /// Secondary action: glass with visible border for contrast.
    func glassButtonSecondary(cornerRadius: CGFloat = 14) -> some View {
        modifier(GlassButtonSecondaryModifier(cornerRadius: cornerRadius))
    }

    /// Input field: pure glass.
    func glassField(cornerRadius: CGFloat = 12) -> some View {
        modifier(GlassFieldModifier(cornerRadius: cornerRadius))
    }

    /// Reusable glass card background (replaces per-view menuCardGlass, profileRowGlass, etc.)
    func glassCard(cornerRadius: CGFloat = 16) -> some View {
        modifier(GlassCardModifier(cornerRadius: cornerRadius))
    }
}

// MARK: - Reusable glass card background modifier

private struct GlassCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    var cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .background {
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .fill(.clear)
                        .glassEffect(
                            .regular.tint(OwnlyColors.glassFillSubtle),
                            in: RoundedRectangle(cornerRadius: cornerRadius)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: cornerRadius)
                                .stroke(OwnlyColors.glassStrokeSubtle, lineWidth: 1)
                        )
                }
        } else {
            content
                .background {
                    Color.clear
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
                        .overlay(
                            RoundedRectangle(cornerRadius: cornerRadius)
                                .stroke(OwnlyColors.glassStrokeSubtle, lineWidth: 1)
                        )
                }
        }
    }
}

// MARK: - Pure SwiftUI spinner (avoids UIKit CircularUIKitProgressView / PlatformViewRepresentableAdaptor)

/// Circular loading indicator implemented in pure SwiftUI. Use instead of `ProgressView()` to avoid
/// "Unable to render flattened version of PlatformViewRepresentableAdaptor<CircularUIKitProgressView>" in Previews and elsewhere.
// Human: Lightweight indeterminate spinner that avoids UIKit’s circular progress representable issues in previews.
// Agent: STRUCT OwnlySpinner View; STATE isAnimating rotationEffect; ANIMATION linear repeatForever; DEFAULT tint primary400.
struct OwnlySpinner: View {
    var tint: Color = OwnlyColors.primary400
    @State private var isAnimating = false

    var body: some View {
        Circle()
            .trim(from: 0.2, to: 1)
            .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            .rotationEffect(.degrees(isAnimating ? 360 : 0))
            .frame(width: 20, height: 20)
            .onAppear { withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { isAnimating = true } }
    }
}

