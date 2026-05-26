import Foundation
import Observation
import Photos

// Human: State and side effects for the onboarding flow (connect, auth, permissions).
// Agent: CALLS MediaVaultAPI; WRITES SessionStore and ServerConfiguration; UPDATES OnboardingStore.
@Observable
@MainActor
final class OnboardingViewModel {
    var step: OnboardingStep = .welcome
    var serverURLText: String = ""
    var email: String = ""
    var password: String = ""
    var confirmPassword: String = ""

    var isTestingConnection = false
    var isConnectionVerified = false
    var connectionMessage: String?
    var connectionIsError = false
    var setupComplete = false

    var isAuthenticating = false
    var authError: String?
    var allowRegistration = false
    var isCreatingAccount = false

    var highlightIndex = 0
    var isRequestingPhotos = false

    private let serverConfiguration: ServerConfiguration
    private let sessionStore: SessionStore
    private let onboardingStore: OnboardingStore

    init(
        serverConfiguration: ServerConfiguration = .shared,
        sessionStore: SessionStore = .shared,
        onboardingStore: OnboardingStore = .shared,
        initialStep: OnboardingStep = .welcome
    ) {
        self.serverConfiguration = serverConfiguration
        self.sessionStore = sessionStore
        self.onboardingStore = onboardingStore
        step = initialStep

        if let url = serverConfiguration.apiBaseURL {
            serverURLText = url.absoluteString
            isConnectionVerified = true
        }
    }

    static func resolvedStartStep(
        session: SessionStore,
        server: ServerConfiguration,
        onboarding: OnboardingStore
    ) -> OnboardingStep {
        if session.isAuthenticated {
            return .ready
        }
        if onboarding.isComplete {
            return server.hasConfiguredServer ? .signIn : .connect
        }
        if server.hasConfiguredServer {
            return .connect
        }
        return .welcome
    }

    func goToNextStep() {
        guard let next = step.next else { return }
        step = next
    }

    func goToPreviousStep() {
        guard let previous = step.previous else { return }
        step = previous
    }

    func skipToConnect() {
        step = .connect
    }

    func pasteFromClipboard() {
        #if canImport(UIKit)
        if let value = UIPasteboard.general.string {
            serverURLText = value
            isConnectionVerified = false
            connectionMessage = nil
        }
        #endif
    }

    func testConnection() async {
        authError = nil
        connectionMessage = nil
        connectionIsError = false
        isConnectionVerified = false

        guard let url = ServerConfiguration.normalizeURLString(serverURLText) else {
            connectionMessage = "Enter a valid server URL."
            connectionIsError = true
            return
        }

        isTestingConnection = true
        defer { isTestingConnection = false }

        do {
            let status = try await MediaVaultAPI.testConnection(baseURL: url)
            setupComplete = status.setupComplete
            try serverConfiguration.setAPIBaseURL(url)
            isConnectionVerified = true
            connectionIsError = false
            if status.setupComplete {
                connectionMessage = "Connected successfully."
            } else {
                connectionMessage = "Connected, but this server still needs setup in a web browser."
            }
            await loadRegistrationSetting()
        } catch {
            connectionIsError = true
            connectionMessage = error.localizedDescription
        }
    }

    func continueFromConnect() {
        guard isConnectionVerified else { return }
        step = .signIn
    }

    func loadRegistrationSetting() async {
        guard let baseURL = serverConfiguration.apiBaseURL else { return }
        do {
            let setting = try await MediaVaultAPI.registrationSetting(baseURL: baseURL)
            allowRegistration = setting.allowPublicRegistration
        } catch {
            allowRegistration = false
        }
    }

    func signIn() async {
        guard let baseURL = serverConfiguration.apiBaseURL else {
            authError = "Connect to a server first."
            return
        }

        authError = nil
        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let response = try await MediaVaultAPI.login(baseURL: baseURL, email: email, password: password)
            try sessionStore.applyAuthResponse(response)
            step = onboardingStore.permissionsPrompted ? (onboardingStore.tourComplete ? .ready : .highlights) : .permissions
        } catch {
            authError = error.localizedDescription
        }
    }

    func createAccount() async {
        guard allowRegistration else { return }
        guard password.count >= 8 else {
            authError = "Password must be at least 8 characters."
            return
        }
        guard password == confirmPassword else {
            authError = "Passwords do not match."
            return
        }
        guard let baseURL = serverConfiguration.apiBaseURL else {
            authError = "Connect to a server first."
            return
        }

        authError = nil
        isCreatingAccount = true
        defer { isCreatingAccount = false }

        do {
            let response = try await MediaVaultAPI.register(baseURL: baseURL, email: email, password: password)
            if response.pendingActivation == true {
                authError = "Account created. An administrator must activate it before you can sign in."
                isCreatingAccount = false
                return
            }
            try sessionStore.applyAuthResponse(response)
            step = .permissions
        } catch {
            authError = error.localizedDescription
        }
    }

    func requestPhotosAccess() async {
        isRequestingPhotos = true
        defer { isRequestingPhotos = false }

        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if current == .authorized || current == .limited {
            onboardingStore.markPermissionsPrompted()
            step = .highlights
            return
        }

        _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        onboardingStore.markPermissionsPrompted()
        step = .highlights
    }

    func skipPermissions() {
        onboardingStore.markPermissionsPrompted()
        step = .highlights
    }

    func nextHighlight() {
        if highlightIndex < highlightSlides.count - 1 {
            highlightIndex += 1
        } else {
            finishTour()
        }
    }

    func skipTour() {
        finishTour()
    }

    private func finishTour() {
        onboardingStore.markTourComplete()
        step = .ready
    }

    func finishOnboarding() {
        onboardingStore.markComplete()
    }

    func changeServer() {
        isConnectionVerified = false
        connectionMessage = nil
        step = .connect
    }

    let highlightSlides: [HighlightSlide] = [
        HighlightSlide(
            symbol: "square.grid.2x2.fill",
            title: "Browse your drive",
            detail: "Grid or list, search, folders, and previews."
        ),
        HighlightSlide(
            symbol: "arrow.up.circle.fill",
            title: "Upload in the background",
            detail: "Queue transfers and resume after interruptions."
        ),
        HighlightSlide(
            symbol: "link.circle.fill",
            title: "Share securely",
            detail: "Time-limited links with optional passwords."
        ),
    ]
}

struct HighlightSlide: Identifiable {
    let id = UUID()
    let symbol: String
    let title: String
    let detail: String
}

#if canImport(UIKit)
import UIKit
#endif
