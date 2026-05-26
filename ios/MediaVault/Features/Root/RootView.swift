import SwiftUI

// Human: Top-level routing between onboarding and the signed-in drive shell.
// Agent: READS SessionStore + OnboardingStore; SHOWS OnboardingFlowView or ContentView.
struct RootView: View {
    @State private var session = SessionStore.shared
    @State private var onboarding = OnboardingStore.shared
    @State private var server = ServerConfiguration.shared

    var body: some View {
        Group {
            if session.isAuthenticated && onboarding.isComplete {
                ContentView()
            } else {
                OnboardingFlowView(startStep: resolvedStartStep)
            }
        }
        .environment(session)
        .environment(onboarding)
        .environment(server)
    }

    private var resolvedStartStep: OnboardingStep {
        OnboardingViewModel.resolvedStartStep(
            session: session,
            server: server,
            onboarding: onboarding
        )
    }
}

#Preview {
    RootView()
}
