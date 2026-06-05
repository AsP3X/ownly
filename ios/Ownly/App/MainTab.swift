import SwiftUI

// Human: Tabs shown in the signed-in main shell bottom bar.
// Agent: ENUM MainTab cases files settings; USED ContentView LiquidGlassTabBar selection binding.
enum MainTab: String, CaseIterable, Identifiable {
    case files
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .files: "Files"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .files: "folder.fill"
        case .settings: "gearshape.fill"
        }
    }
}
