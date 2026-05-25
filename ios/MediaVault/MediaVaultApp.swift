import SwiftUI

// Human: SwiftUI application entry for the MediaVault iOS client.
// Agent: READS AppConfiguration; LAUNCHES ContentView as root scene.
@main
struct MediaVaultApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
