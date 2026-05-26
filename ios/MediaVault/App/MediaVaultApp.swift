import SwiftUI

// Human: App entry wires global appearance and injects shared AppState for server configuration.
// Agent: @main App; @State AppState; body WindowGroup RootView environment appState.
@main
struct MediaVaultApp: App {
    @UIApplicationDelegateAdaptor(MediaVaultAppDelegate.self) private var appDelegate
    @AppStorage("mediavault.appearance") private var appearance: String = "system"
    @State private var appState = AppState()

    private var resolvedColorScheme: ColorScheme? {
        switch appearance {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.appState, appState)
                .preferredColorScheme(resolvedColorScheme)
        }
    }
}
