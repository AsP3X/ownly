import SwiftUI

// Human: Root coordinator matching the Cloudwrkz iOS 26 shell — auth stack over always-mounted main content.
// Agent: ZStack ContentView + splash/login/register; server config + health sheets; logout clears token/profile.
struct RootView: View {
    @Environment(\.appState) private var appState

    @State private var authFlow = AuthFlowController()
    @State private var showServerConfig = false
    @State private var showHealthStatus = false
    @State private var allowRegistration = false

    private let pushPopAnimation = Animation.elasticSlide

    private func clearSession() {
        AuthTokenStorage.clear()
        UserProfileStorage.clear()
    }

    var body: some View {
        ZStack {
            ContentView(
                isMainVisible: authFlow.screen == .main,
                showServerConfig: $showServerConfig,
                onLogout: {
                    clearSession()
                    withAnimation(pushPopAnimation) {
                        authFlow.goForward(to: .splash)
                    }
                }
            )
            .opacity(authFlow.screen == .main ? 1 : 0)

            switch authFlow.screen {
            case .splash:
                SplashView(
                    onLogin: { authFlow.goForward(to: .login) },
                    onRegister: {
                        if allowRegistration {
                            authFlow.goForward(to: .register)
                        } else {
                            authFlow.goForward(to: .login)
                        }
                    }
                )
                .transition(.asymmetric(
                    insertion: .move(edge: .leading),
                    removal: .move(edge: .leading)
                ))
            case .login:
                LoginView(
                    onSuccess: { authFlow.goForward(to: .main) },
                    onBack: { authFlow.goBack(to: .splash) }
                )
                .transition(authTransition)
            case .register:
                RegisterView(
                    onSuccess: { authFlow.goForward(to: .login) },
                    onBack: { authFlow.goBack(to: .splash) }
                )
                .transition(authTransition)
            case .main:
                EmptyView()
            }

            VStack {
                HStack(spacing: 0) {
                    if authFlow.screen == .login || authFlow.screen == .register {
                        Color.clear
                            .frame(width: 44, height: 44)
                            .allowsHitTesting(false)
                    }
                    TenantStatusView(config: appState.config, onTap: { showHealthStatus = true })
                        .padding(.leading, 12)
                        .padding(.top, 12)
                    Spacer()
                    Button(action: { showServerConfig = true }) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(OwnlyColors.neutral100)
                            .frame(width: 44, height: 44)
                    }
                    .padding(.trailing, 12)
                    .padding(.top, 12)
                }
                Spacer()
            }
            .allowsHitTesting(authFlow.screen != .main)
            .opacity(authFlow.screen == .main ? 0 : 1)
        }
        .animation(pushPopAnimation, value: authFlow.screen)
        .task {
            allowRegistration = await AuthService.registrationSetting(config: appState.config)
        }
        .onChange(of: appState.config) { _, newConfig in
            Task {
                allowRegistration = await AuthService.registrationSetting(config: newConfig)
            }
        }
        .sheet(isPresented: $showServerConfig) {
            ServerConfigView(config: Binding(
                get: { appState.config },
                set: { appState.config = $0 }
            ))
        }
        .sheet(isPresented: $showHealthStatus) {
            ServerHealthStatusView(config: appState.config)
        }
    }

    private var authTransition: AnyTransition {
        .asymmetric(
            insertion: authFlow.isGoingBack ? .move(edge: .leading) : .move(edge: .trailing),
            removal: authFlow.isGoingBack ? .move(edge: .trailing) : .move(edge: .leading)
        )
    }
}

#Preview {
    RootView()
        .environment(\.appState, AppState())
}
