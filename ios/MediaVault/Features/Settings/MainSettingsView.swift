import SwiftUI

// Human: Signed-in Settings tab — account summary, server config entry, and logout.
// Agent: READS UserProfileStorage appState; CALLS onShowServerConfig onLogout; WRITES via parent callbacks only.
struct MainSettingsView: View {
    @Environment(\.appState) private var appState
    var onShowServerConfig: () -> Void
    var onLogout: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(MediaVaultColors.textOnGradient)

                accountSection
                serverSection
                logoutSection
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 120)
        }
    }

    // MARK: - Sections

    private var accountSection: some View {
        settingsGroup(title: "Account") {
            settingsRow(
                icon: "person.crop.circle.fill",
                title: UserProfileStorage.email ?? "Signed in",
                subtitle: "MediaVault account"
            )
        }
    }

    private var serverSection: some View {
        settingsGroup(title: "Server") {
            Button(action: onShowServerConfig) {
                settingsRow(
                    icon: "server.rack",
                    title: appState.config.displayHost,
                    subtitle: "Tap to change server URL",
                    showsChevron: true
                )
            }
            .buttonStyle(.plain)
        }
    }

    private var logoutSection: some View {
        Button(role: .destructive, action: onLogout) {
            HStack(spacing: 12) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 18, weight: .semibold))
                Text("Log out")
                    .font(.body.weight(.semibold))
                Spacer()
            }
            .foregroundStyle(MediaVaultColors.error500)
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(cornerRadius: 16)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Building blocks

    private func settingsGroup<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(MediaVaultColors.neutral500)
                .padding(.leading, 4)

            content()
                .glassCard(cornerRadius: 16)
        }
    }

    private func settingsRow(
        icon: String,
        title: String,
        subtitle: String,
        showsChevron: Bool = false
    ) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 22))
                .foregroundStyle(MediaVaultColors.primary400)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(MediaVaultColors.neutral100)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(MediaVaultColors.neutral400)
            }

            Spacer()

            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(MediaVaultColors.neutral500)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
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

        MainSettingsView(onShowServerConfig: {}, onLogout: {})
            .environment(\.appState, AppState())
    }
}
