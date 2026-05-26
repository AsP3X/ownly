import Foundation

// Human: Ordered steps in the first-use onboarding flow.
// Agent: DRIVES OnboardingFlowView navigation and progress indicator counts.
enum OnboardingStep: Int, CaseIterable, Identifiable {
    case welcome = 1
    case connect
    case signIn
    case permissions
    case highlights
    case ready

    var id: Int { rawValue }

    var screenTitle: String {
        switch self {
        case .welcome:
            "Welcome"
        case .connect:
            "Connect to your server"
        case .signIn:
            "Sign in"
        case .permissions:
            "Access your library"
        case .highlights:
            "Quick tour"
        case .ready:
            "You're all set"
        }
    }

    var screenSubtitle: String {
        switch self {
        case .welcome:
            "Your media. Your server. Everywhere."
        case .connect:
            "Paste the URL from your MediaVault admin panel."
        case .signIn:
            "Use the account on your connected instance."
        case .permissions:
            "Optional access for uploads and downloads."
        case .highlights:
            "Swipe through what you can do in the app."
        case .ready:
            "Your files are waiting in your drive."
        }
    }

    var next: OnboardingStep? {
        OnboardingStep(rawValue: rawValue + 1)
    }

    var previous: OnboardingStep? {
        OnboardingStep(rawValue: rawValue - 1)
    }
}
