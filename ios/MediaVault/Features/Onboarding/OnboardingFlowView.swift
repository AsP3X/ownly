import SwiftUI

// Human: Coordinates step transitions for the first-use onboarding flow.
// Agent: SWITCHES step views; READS OnboardingViewModel.step; MARKS onboarding complete on ready.
struct OnboardingFlowView: View {
    @State private var model: OnboardingViewModel

    init(startStep: OnboardingStep = .welcome) {
        _model = State(initialValue: OnboardingViewModel(initialStep: startStep))
    }

    var body: some View {
        Group {
            switch model.step {
            case .welcome:
                OnboardingWelcomeView(model: model)
            case .connect:
                OnboardingConnectView(model: model)
            case .signIn:
                OnboardingSignInView(model: model)
            case .permissions:
                OnboardingPermissionsView(model: model)
            case .highlights:
                OnboardingHighlightsView(model: model)
            case .ready:
                OnboardingReadyView(model: model)
            }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.99)))
        .animation(.spring(response: 0.35), value: model.step)
        .interactiveDismissDisabled()
    }
}

#Preview("Onboarding flow") {
    OnboardingFlowView()
}
