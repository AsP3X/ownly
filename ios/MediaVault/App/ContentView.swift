import SwiftUI

// Human: Signed-in main shell with tab content and a liquid-glass bottom bar (Files · Upload · Settings).
// Agent: STATE selectedTab showServerConfig showUploadPlaceholder; SWITCHES FilesView MainSettingsView; CALLS onLogout from RootView.
struct ContentView: View {
    var isMainVisible: Bool = true
    var showServerConfig: Binding<Bool> = .constant(false)
    var onLogout: (() -> Void)? = nil

    @State private var selectedTab: MainTab = .files
    @State private var showUploadPlaceholder = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [MediaVaultColors.primary950, MediaVaultColors.neutral950],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            tabContent

            VStack {
                Spacer()
                LiquidGlassTabBar(
                    selectedTab: $selectedTab,
                    onUpload: { showUploadPlaceholder = true }
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
        }
        .opacity(isMainVisible ? 1 : 0)
        .preferredColorScheme(.light)
        .alert("Upload", isPresented: $showUploadPlaceholder) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("File upload will be available when the native drive UI is implemented.")
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .files:
            FilesView()
        case .settings:
            MainSettingsView(
                onShowServerConfig: { showServerConfig.wrappedValue = true },
                onLogout: { onLogout?() }
            )
        }
    }
}

#Preview {
    ContentView()
        .environment(\.appState, AppState())
}
