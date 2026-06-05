import SwiftUI

// Human: Marketing splash with sign-in and register entry points on the gradient shell.
// Agent: DISPLAYS Ownly greeting + welcome copy; CALLS onLogin/onRegister closures from AuthFlowController.
struct SplashView: View {
    @State private var appeared = false
    var onLogin: () -> Void = {}
    var onRegister: () -> Void = {}

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [OwnlyColors.primary950, OwnlyColors.neutral950],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 0)

                VStack(spacing: 14) {
                    Text("Ownly")
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .foregroundStyle(OwnlyColors.textOnGradient)
                        .multilineTextAlignment(.center)

                    Text("Welcome. Store, stream, and share your media on your own terms.")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(OwnlyColors.neutral400)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)

                Spacer(minLength: 0)

                VStack(spacing: 14) {
                    Button(action: onLogin) {
                        Text("Sign in")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OwnlyColors.textOnGradient)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                    }
                    .glassButtonPrimary()

                    Button(action: onRegister) {
                        Text("Create account")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OwnlyColors.primary400)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                    }
                    .glassButtonSecondary()
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 20)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) {
                appeared = true
            }
        }
    }
}

#Preview {
    SplashView()
}
