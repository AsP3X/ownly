import SwiftUI

// Human: SwiftUI application entry for the MediaVault iOS client.
// Agent: LAUNCHES RootView which routes between onboarding and the drive shell.
@main
struct MediaVaultApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
