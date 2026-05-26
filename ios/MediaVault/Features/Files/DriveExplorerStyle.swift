import SwiftUI

// Human: Light-mode visual tokens for the file explorer redesign.
// Agent: Provides explicit colors so Files tab stays light and does not inherit the dark liquid-glass shell.
enum DriveExplorerStyle {
    static let backgroundTop = Color(red: 0.98, green: 0.985, blue: 1.0)
    static let backgroundBottom = Color(red: 0.94, green: 0.96, blue: 0.99)

    static let surface = Color.white.opacity(0.86)
    static let surfaceRaised = Color.white.opacity(0.96)
    static let surfaceMuted = Color(red: 0.93, green: 0.95, blue: 0.98)
    static let separator = Color.black.opacity(0.08)

    static let textPrimary = Color(red: 0.08, green: 0.10, blue: 0.14)
    static let textSecondary = Color(red: 0.34, green: 0.38, blue: 0.46)
    static let textTertiary = Color(red: 0.52, green: 0.57, blue: 0.66)

    static let accent = Color(red: 0.00, green: 0.36, blue: 0.86)
    static let accentSoft = Color(red: 0.88, green: 0.93, blue: 1.0)
    static let folderFill = Color(red: 0.88, green: 0.94, blue: 1.0)
    static let folderIcon = Color(red: 0.00, green: 0.42, blue: 0.90)

    static let image = Color(red: 0.88, green: 0.28, blue: 0.42)
    static let video = Color(red: 0.50, green: 0.33, blue: 0.86)
    static let audio = Color(red: 0.90, green: 0.45, blue: 0.18)
    static let spreadsheet = Color(red: 0.15, green: 0.58, blue: 0.32)
    static let presentation = Color(red: 0.86, green: 0.39, blue: 0.17)
    static let document = Color(red: 0.12, green: 0.42, blue: 0.78)
    static let generic = Color(red: 0.48, green: 0.53, blue: 0.62)
    static let warning = Color(red: 0.76, green: 0.42, blue: 0.00)
}

// Human: Three-dot indeterminate loader for folder/file fetches in the Files explorer.
// Agent: STRUCT MediaVaultBouncingDots; STAGGERED easeInOut repeatForever per dot; DEFAULT tint DriveExplorerStyle.accent.
struct MediaVaultBouncingDots: View {
    var tint: Color = DriveExplorerStyle.accent
    var dotSize: CGFloat = 8
    var bounceHeight: CGFloat = 6

    @State private var isAnimating = false

    var body: some View {
        HStack(spacing: dotSize * 0.65) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(tint)
                    .frame(width: dotSize, height: dotSize)
                    .offset(y: isAnimating ? -bounceHeight : 0)
                    .animation(
                        .easeInOut(duration: 0.42)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.14),
                        value: isAnimating
                    )
            }
        }
        .frame(height: dotSize + bounceHeight)
        .onAppear { isAnimating = true }
        .onDisappear { isAnimating = false }
    }
}
