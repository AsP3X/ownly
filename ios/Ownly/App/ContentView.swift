import SwiftUI

// Human: Signed-in main shell with tab content and a liquid-glass bottom bar (Files · Upload · Settings).
// Agent: STATE selectedTab showServerConfig showUploadPlaceholder; SWITCHES FilesView MainSettingsView; CALLS onLogout from RootView.
struct ContentView: View {
    var isMainVisible: Bool = true
    var showServerConfig: Binding<Bool> = .constant(false)
    var onLogout: (() -> Void)? = nil

    @Environment(\.appState) private var appState
    @State private var selectedTab: MainTab = .files
    @State private var showUploadFilePicker = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [OwnlyColors.primary950, OwnlyColors.neutral950],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            tabContent

            VStack {
                Spacer()
                LiquidGlassTabBar(
                    selectedTab: $selectedTab,
                    onUpload: { showUploadFilePicker = true }
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
        }
        .opacity(isMainVisible ? 1 : 0)
        .preferredColorScheme(.light)
        .uploadFilePicker(isPresented: $showUploadFilePicker) { urls in
            appState.uploadManager.startBatch(
                fileURLs: urls,
                folderId: appState.uploadManager.targetFolderId
            )
        }
        .onAppear {
            appState.uploadManager.bind(config: appState.config)
        }
        .onChange(of: appState.config) { _, newConfig in
            appState.uploadManager.bind(config: newConfig)
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .files:
            FilesView(onSessionExpired: { onLogout?() })
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
