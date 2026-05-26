import SwiftUI

// Human: Floating signed-in bottom bar — Files and Settings tabs with a raised round upload button in the center.
// Agent: READS selectedTab Binding; CALLS onUpload; USES glassPanel glassButtonPrimary MediaVaultColors; iOS 26 glassEffect via design modifiers.
struct LiquidGlassTabBar: View {
    @Binding var selectedTab: MainTab
    var onUpload: () -> Void

    private let barHeight: CGFloat = 64
    private let uploadSize: CGFloat = 56
    private let uploadLift: CGFloat = 18

    var body: some View {
        ZStack(alignment: .top) {
            HStack(spacing: 0) {
                tabButton(for: .files)
                Spacer(minLength: uploadSize + 8)
                tabButton(for: .settings)
            }
            .padding(.horizontal, 28)
            .frame(height: barHeight)
            .glassPanel(cornerRadius: barHeight / 2)

            uploadButton
                .offset(y: -uploadLift)
        }
        .padding(.bottom, 4)
    }

    // MARK: - Tab items

    private func tabButton(for tab: MainTab) -> some View {
        let isSelected = selectedTab == tab

        return Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.72)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                    .symbolRenderingMode(.hierarchical)

                Text(tab.title)
                    .font(.caption2.weight(isSelected ? .semibold : .medium))
            }
            .foregroundStyle(isSelected ? MediaVaultColors.primary400 : MediaVaultColors.neutral400)
            .frame(minWidth: 72)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: - Center upload

    private var uploadButton: some View {
        Button(action: onUpload) {
            Image(systemName: "plus")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(MediaVaultColors.textOnGradient)
                .frame(width: uploadSize, height: uploadSize)
                .glassButtonPrimary(cornerRadius: uploadSize / 2)
                .shadow(color: MediaVaultColors.primary600.opacity(0.35), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Upload")
    }
}

#Preview {
    ZStack {
        LinearGradient(
            colors: [MediaVaultColors.primary950, MediaVaultColors.neutral950],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()

        VStack {
            Spacer()
            LiquidGlassTabBar(selectedTab: .constant(.files), onUpload: {})
                .padding(.horizontal, 24)
        }
    }
}
