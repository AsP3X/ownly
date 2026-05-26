//
//  AppState.swift
//  MediaVault
//
//  Shared app state: single source of truth for ServerConfig. Injected via environment.
//

import SwiftUI

// Human: Holds the active `ServerConfig` (API base URL, etc.) for the whole UI tree via SwiftUI environment.
// Agent: @Observable class config ServerConfig; init DEFAULT load; reloadFromStorage REASSIGNS from UserDefaults.

@Observable
final class AppState {
    var config: ServerConfig

    init(config: ServerConfig = ServerConfig.load()) {
        self.config = config
    }

    /// Reload config from UserDefaults (e.g. after another process changed it). Rare.
    func reloadFromStorage() {
        config = ServerConfig.load()
    }
}

// MARK: - Environment

private struct AppStateKey: EnvironmentKey {
    static let defaultValue: AppState = AppState()
}

extension EnvironmentValues {
    // Human: Views reach for `@Environment(\.appState)` instead of singletons so previews/tests can swap configuration cleanly.
    // Agent: GET/SET EnvironmentKey AppStateKey on EnvironmentValues.

    var appState: AppState {
        get { self[AppStateKey.self] }
        set { self[AppStateKey.self] = newValue }
    }
}
